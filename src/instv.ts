#!/usr/bin/env node
import { createProgram } from "./cli.js";
import { addExampleCommand } from "./example.js";

const program = createProgram();
addExampleCommand(program);
await program.parseAsync();
