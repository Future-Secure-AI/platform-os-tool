#!/usr/bin/env node

import { cac } from "cac";
import process from "node:process";
import packageTool from "./commands/packageTool.ts";

const cli = cac("os");

cli.command("package-tool <folder>", "Package a tool in a given folder. Ie `os build-tool .` to build current folder").option("-i, --no-increment-version", "Do not increment the version in package.json after packaging").action(packageTool);

cli.help();

try {
	cli.parse();
} catch (error) {
	if (error && typeof error === "object" && "name" in error && error.name === "CACError") {
		process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
		cli.outputHelp();
		process.exit(1);
	}
	throw error;
}

if (process.argv.length <= 2) {
	cli.outputHelp();
}
