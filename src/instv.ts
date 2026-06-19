#!/usr/bin/env node
import { createProgram } from "./cli.js";
import { addExampleCommand } from "./examples.js";

const program = createProgram().name("instv");
addExampleCommand(program);
await program.parseAsync();
