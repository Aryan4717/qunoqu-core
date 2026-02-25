#!/usr/bin/env node
/**
 * @qunoqu/cli – CLI entrypoint
 */

import { hello } from "@qunoqu/core";

function main(): void {
  console.log(hello());
}

main();
