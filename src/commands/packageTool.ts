import archiver from "archiver";
import chalk from "chalk";
import copyfiles from "copyfiles";
import { glob } from "glob";
import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "../models/Options.ts";
import type { Package } from "../models/Package.ts";

const ASSET_PATTERNS = ["**/*.png", "**/*.svg", "**/*.json"];

export default async function packageTool(projectFolder: string, options: Options) {
	const { revision = generateDevRevision() } = options;

	if (!(await exists(projectFolder))) {
		process.stdout.write(chalk.red(`Project folder does not exist: ${projectFolder}\n`));
		process.exit(1);
	}

	const srcFolder = join(projectFolder, "src");
	if (!(await exists(srcFolder))) {
		process.stdout.write(chalk.red(`Source folder does not exist: ${srcFolder}\n`));
		process.exit(1);
	}

	const readmeFile = join(projectFolder, "README.md");
	if (!(await exists(readmeFile))) {
		process.stdout.write(chalk.red(`Readme file does not exist: ${readmeFile}\n`));
		process.exit(1);
	}

	let packageFile = join(projectFolder, "package.json");
	if (!(await exists(packageFile))) {
		process.stdout.write(chalk.red(`Package file does not exist: ${packageFile}\n`));
		process.exit(1);
	}
	packageFile = await prepareVersionedPackage(packageFile, revision);

	const { name, version } = await readPackage(packageFile);

	const publishFolder = join(projectFolder, "publish");
	await fs.mkdir(publishFolder, { recursive: true });

	const buildFolder = await build(srcFolder, packageFile, readmeFile);
	const bundleFile = await bundle(buildFolder, publishFolder, name, version);

	await fs.rm(buildFolder, { recursive: true, force: true });
	process.stdout.write(`${chalk.cyan(name)}@${chalk.cyan(version)} packaged as ${chalk.cyan(bundleFile)}.\n`);
}

function generateDevRevision(): string {
	return `${Math.floor(Date.now() / 10_000) - 175200000}-dev`; // This number has no significance, it could be any number to reduce length.
}

async function readPackage(packageFilePath: string): Promise<Package> {
	const raw = await fs.readFile(packageFilePath, "utf-8");
	return JSON.parse(raw);
}

async function writePackage(packageFilePath: string, packageData: Package): Promise<void> {
	const packageJson = JSON.stringify(packageData, null, "\t");
	await fs.writeFile(packageFilePath, `${packageJson}\n`, "utf-8");
}

async function prepareVersionedPackage(inputPackageFilePath: string, revision: string): Promise<string> {
	const pkg = await readPackage(inputPackageFilePath);

	const versionParts = pkg.version.split(".");
	versionParts[2] = revision;
	const revisedProjectVersion = versionParts.join(".");

	const outputPackageFilePath = join(tmpdir(), `package-${Math.random().toString(36).slice(2, 10)}.tmp`);
	await writePackage(outputPackageFilePath, {
		...pkg,
		version: revisedProjectVersion,
	});

	return outputPackageFilePath;
}

async function build(srcFolder: string, packageFile: string, readmeFile: string): Promise<string> {
	const buildFolder = await createTempFolder();
	const tsc = new Promise<void>((resolve, reject) => {
		const files = glob.sync("**/*.ts", {
			cwd: srcFolder,
			ignore: ["**/*.test.ts", "**/*.spec.ts", "**/test/**"],
			absolute: true,
		});
		const buildProcess = spawn(
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
				"es2022",
				"--preserveConstEnums",
				"--esModuleInterop",
				"--resolveJsonModule",
				"--declaration",
				"--sourceMap",

				"--strict",
				"--forceConsistentCasingInFileNames",
				"--strictNullChecks",
				"--noUnusedLocals",
				"--noUnusedParameters",
				"--noUncheckedIndexedAccess",
				"--noImplicitAny",
				"--noImplicitReturns",

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
		fs.copyFile(readmeFile, join(buildFolder, "README.md")), // Readme
		...ASSET_PATTERNS.map((pattern) => globFileCopy(srcFolder, buildFolder, pattern)), // Assets
	]);

	async function createTempFolder() {
		return await fs.mkdtemp(join(os.tmpdir(), "build-"));
	}

	async function globFileCopy(srcFolder: string, dstFolder: string, pattern: string): Promise<void> {
		return new Promise((resolve, reject) => {
			copyfiles([join(srcFolder, pattern), dstFolder], { up: 1 }, (error: unknown) => {
				// TODO: There is something hinky about this "up". If invoked from another folder this may exclude assets.
				if (error) reject(error);
				else resolve();
			});
		});
	}

	return buildFolder;
}

async function bundle(buildFolderPath: string, publishFolder: string, projectName: string, projectVersion: string): Promise<string> {
	const bundleFile = join(publishFolder, createName(projectName, projectVersion));

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

function createName(projectName: string, projectVersion: string): string {
	const slashIndex = projectName.lastIndexOf("/");
	const baseName = slashIndex !== -1 ? projectName.substring(slashIndex + 1) : projectName;
	return `${baseName}-${projectVersion.replaceAll(".", "_")}.zip`;
}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
