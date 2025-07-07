import archiver from "archiver";
import chalk from "chalk";
import copyfiles from "copyfiles";
import { execa } from "execa";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { join } from "node:path";
import type { BaseArgs } from "../models/BaseArgs.ts";
import type { Package } from "../models/Package.ts";

const tsConfigFile = join(__dirname, "..", "..", "tsconfig.jsonc"); // TODO
const ASSET_PATTERNS = ["*.png", "*.svg", "*.json"];

export default async function buildTool(folder: string, _base: BaseArgs) {
	const projectFolder = join(process.cwd(), folder);
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

	const tempBuildFolder = await fs.mkdtemp("build-");
	try {
		process.stdout.write(`Build ${chalk.cyan(name)}@${chalk.cyan(version)} from ${chalk.cyan(projectFolder)}...\n`);
		await build(projectFolder, packageFile, srcFolder, tempBuildFolder);
		await bundle(tempBuildFolder, publishFolder, name, version);
		// TODO
	} finally {
		await fs.rm(tempBuildFolder, { recursive: true, force: true });
	}
}

async function readPackage(packageFilePath: string): Promise<Package> {
	const raw = await fs.readFile(packageFilePath, "utf-8");
	return JSON.parse(raw);
}

async function build(projectFolder: string, packageFile: string, srcFolder: string, buildFolder: string): Promise<void> {
	const tsc = execa("npx", ["tsc", "--project", tsConfigFile, "--outDir", buildFolder], {
		cwd: projectFolder,
		stdio: "inherit",
	});

	const outputPackageFile = join(buildFolder, "package.json");
	await Promise.all([
		tsc, // Build
		fs.copyFile(packageFile, outputPackageFile), // Package
		...ASSET_PATTERNS.map((pattern) => globFileCopy(srcFolder, buildFolder, pattern)), // Assets
	]);

	async function globFileCopy(srcFolder: string, dstFolder: string, pattern: string): Promise<void> {
		return new Promise((resolve, reject) => {
			copyfiles([join(srcFolder, pattern), dstFolder], { up: true }, (error: unknown) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}
}

async function bundle(buildFolderPath: string, publishFolder: string, projectName: string, projectVersion: string): Promise<void> {
	const bundleFile = join(publishFolder, `${projectName}-${projectVersion}.zip`);

	if (await exists(bundleFile)) {
		await fs.rm(bundleFile);
	}

	const output = fsSync.createWriteStream(bundleFile);

	const archive = archiver("zip", {
		zlib: { level: 9 },
	});

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
}

async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
