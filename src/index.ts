#!/usr/bin/env node

import { cac } from "cac";
import process from "node:process";
import buildTool from "./commands/buildTool.ts";

const cli = cac("os");

cli.command("build-tool <folder>", "Build a tool in a given folder. Ie `os build-tool .` to build current folder").action(buildTool);

cli.help();

try {
	cli.parse();
} catch (err) {
	if (err && typeof err === "object" && "name" in err && err.name === "CACError") {
		process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
		cli.outputHelp();
		process.exit(1);
	}
	throw err;
}

if (process.argv.length <= 2) {
	cli.outputHelp();
}
