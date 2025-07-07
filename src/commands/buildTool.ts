import chalk from "chalk";
import type { BaseArgs } from "../models/BaseArgs.ts";

export default async function buildTool(folder: string | undefined, _base: BaseArgs) {
	process.stdout.write(`${chalk.cyan("Placeholder: ")}n`);
}
