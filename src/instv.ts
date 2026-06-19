#!/usr/bin/env node
import { createProgram } from "./cli.js";

await createProgram()
  .name("instv")
  .parseAsync();
