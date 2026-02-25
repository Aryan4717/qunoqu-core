/**
 * @qunoqu/vscode-ext – VS Code extension entry
 */

import * as vscode from "vscode";
import { hello } from "@qunoqu/core";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("qunoqu.hello", () => {
      vscode.window.showInformationMessage(hello());
    })
  );
}

export function deactivate(): void {}
