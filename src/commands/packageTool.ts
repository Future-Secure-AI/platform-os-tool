import archiver from "archiver";
import chalk from "chalk";
import copyfiles from "copyfiles";
import { glob } from "glob";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import type { BaseArgs } from "../models/BaseArgs.ts";
import type { Package } from "../models/Package.ts";

const ASSET_PATTERNS = ["*.png", "*.svg", "*.json"];

export default async function packageTool(projectFolder: string, _base: BaseArgs) {
	if (!(await exists(projectFolder))) {
		process.stdout.write(chalk.red(`Project folder does not exist: ${projectFolder}\n`));
		process.exit(1);
	}

	const srcFolder = join(projectFolder, "src");
	if (!(await exists(srcFolder))) {
		process.stdout.write(chalk.red(`Source folder does not exist: ${srcFolder}\n`));
		process.exit(1);
	}

	const packageFile = join(projectFolder, "package.json");
	if (!(await exists(packageFile))) {
		process.stdout.write(chalk.red(`Package file does not exist: ${packageFile}\n`));
		process.exit(1);
	}
	const { name, version } = await readPackage(packageFile);

	const publishFolder = join(projectFolder, "publish");
	await fs.mkdir(publishFolder, { recursive: true });

	const buildFolder = await build(srcFolder, packageFile);
	const bundleFile = await bundle(buildFolder, publishFolder, name, version);
	await incrementPackageVersion(packageFile, 0, 0, 1);

	await fs.rm(buildFolder, { recursive: true, force: true });
	process.stdout.write(`${chalk.cyan(name)}@${chalk.cyan(version)} packaged as ${chalk.cyan(bundleFile)}.\n`);
}

async function readPackage(packageFilePath: string): Promise<Package> {
	const raw = await fs.readFile(packageFilePath, "utf-8");
	return JSON.parse(raw);
}

async function writePackage(packageFilePath: string, packageData: Package): Promise<void> {
	const packageJson = JSON.stringify(packageData, null, "\t");
	await fs.writeFile(packageFilePath, `${packageJson}\n`, "utf-8");
}

async function incrementPackageVersion(packageFilePath: string, majorOffset: number, minorOffset: number, revisionOffset: number): Promise<void> {
	const pkg = await readPackage(packageFilePath);

	const versionParts = pkg.version.split(".").map(Number);
	versionParts[0] = (versionParts[0] ?? 0) + majorOffset;
	versionParts[1] = (versionParts[1] ?? 0) + minorOffset;
	versionParts[2] = (versionParts[2] ?? 0) + revisionOffset;
	const revisedProjectVersion = versionParts.join(".");

	await writePackage(packageFilePath, {
		...pkg,
		version: revisedProjectVersion,
	});
}

async function build(srcFolder: string, packageFile: string): Promise<string> {
	const buildFolder = await createTempFolder();
	const tsc = new Promise<void>((resolve, reject) => {
		const files = glob.sync(`${srcFolder}/**/*.ts`, {
			ignore: ["**/*.test.ts", "**/*.spec.ts", "**/test/**"],
		});

		const buildProcess = spawn(
			// TODO: Refine these
			"npx",
			[
				"tsc",
				"--module",
				"NodeNext",
				"--moduleResolution",
				"NodeNext",
				"--importHelpers",
				"false",
				"--noEmitHelpers",
				"false",
				"--target",
				"es2019",
				"--lib",
				"es2019,es2020,es2022.error",
				"--forceConsistentCasingInFileNames",
				"--noImplicitAny",
				"--noImplicitReturns",
				"--strictNullChecks",
				"--preserveConstEnums",
				"--esModuleInterop",
				"--resolveJsonModule",
				"--declaration",
				"--sourceMap",
				"--skipLibCheck",
				"--outDir",
				buildFolder,
				...files,
			],
			{
				stdio: "inherit",
			},
		);

		buildProcess.on("error", (_error) => {
			process.exit(1);
		});

		buildProcess.on("close", async (code) => {
			if (code === 0) {
				try {
					resolve();
				} catch (copyErr) {
					reject(copyErr);
				}
			} else {
				process.exit(code);
			}
		});
	});

	await Promise.all([
		tsc, // Base build
		fs.copyFile(packageFile, join(buildFolder, "package.json")), // Package
		...ASSET_PATTERNS.map((pattern) => globFileCopy(srcFolder, buildFolder, pattern)), // Assets
	]);

	async function createTempFolder() {
		return await fs.mkdtemp(join(os.tmpdir(), "build-"));
	}

	async function globFileCopy(srcFolder: string, dstFolder: string, pattern: string): Promise<void> {
		return new Promise((resolve, reject) => {
			copyfiles([join(srcFolder, pattern), dstFolder], { up: true }, (error: unknown) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	return buildFolder;
}

async function bundle(buildFolderPath: string, publishFolder: string, projectName: string, projectVersion: string): Promise<string> {
	const bundleFile = join(publishFolder, `${projectName}-${projectVersion}.zip`);

	if (await exists(bundleFile)) {
		await fs.rm(bundleFile);
	}

	const output = fsSync.createWriteStream(bundleFile);
	const archive = archiver("zip", { zlib: { level: 9 } });

	archive.on("error", (err: unknown) => {
		throw err;
	});

	archive.pipe(output);
	archive.directory(buildFolderPath, false);

	await archive.finalize();

	await new Promise<void>((resolve, reject) => {
		output.on("close", resolve);
		output.on("error", reject);
	});

	return bundleFile;
}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
