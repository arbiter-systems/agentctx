#!/usr/bin/env node
import { createProgram } from "./cli.js";
import { addExampleCommand } from "./example.js";

const program = createProgram().name("instv");
addExampleCommand(program);
await program.parseAsync();
