#!/usr/bin/env node
import { createProgram } from "./cli.js";
import { addExampleCommand } from "./example.js";
import { addReviewCommand } from "./review.js";

const program = createProgram();
addExampleCommand(program);
addReviewCommand(program);
await program.parseAsync();
