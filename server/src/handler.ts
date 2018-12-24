import * as fs from "fs";
import * as path from "path";
import * as glob from "glob";
import * as LServer from "vscode-languageserver";
import * as abaplint from "abaplint";
import Uri from "vscode-uri";
import {Registry} from "abaplint/build/src/registry"; // todo, typing?
import {versionToText} from "abaplint/build/src/version"; // todo, typing?

interface IFolder {
  root: string;
  dotabapgit: string | undefined;
  starting: string;
}

export class Handler {
  private folders: IFolder[] = [];
  private reg: Registry;
  private configInfo: string;
  private connection: LServer.Connection;

  constructor(connection: LServer.Connection, params: LServer.InitializeParams) {
    this.reg = new abaplint.Registry();
    this.connection = connection;
    this.setFolders(params.workspaceFolders);
    this.readConfig();
  }

  public validateDocument(textDocument: LServer.TextDocument) {
    const diagnostics: LServer.Diagnostic[] = [];

    const file = new abaplint.MemoryFile(textDocument.uri, textDocument.getText().replace(/\r/g, ""));
    try {
      this.reg.updateFile(file);
    } catch  {
      this.reg.addFile(file);
    }

    for (const issue of this.reg.findIssues()) {
      if (issue.getFile().getFilename() === textDocument.uri) {
        const diagnosic: LServer.Diagnostic = {
          severity: LServer.DiagnosticSeverity.Error,
          range: {
            start: {line: issue.getStart().getRow() - 1, character: issue.getStart().getCol() - 1},
            end: {line: issue.getEnd().getRow() - 1, character: issue.getEnd().getCol() - 1},
          },
          code: issue.getCode(),
          message: issue.getMessage().toString(),
          source: "abaplint",
        };
        diagnostics.push(diagnosic);
      }
    }

    this.connection.sendDiagnostics({uri: textDocument.uri, diagnostics});
  }

  public loadAndParseAll() {
    this.connection.sendNotification("abaplint/status", {text: "$(sync~spin) Parsing Files"});

    for (const folder of this.folders) {
      const filenames = glob.sync(folder.starting + "**" + path.sep + "*.*", {nosort: true, nodir: true});
      for (const filename of filenames) {
        const raw = fs.readFileSync(filename, "utf-8");
        this.reg.addFile(new abaplint.MemoryFile(filename, raw.replace(/\r/g, "")));
      }
    }

    this.reg.parse();

    const tooltip = "ABAP version: " + versionToText(this.reg.getConfig().getVersion()) + "\n" +
      "abaplint: " + Registry.abaplintVersion() + "\n" +
      "config: " + this.configInfo + "\n" +
      "Objects: " + this.reg.getObjects().length;
    this.connection.sendNotification("abaplint/status", {text: "Ready", tooltip});
  }

  private setFolders(workspaces: LServer.WorkspaceFolder[] | null) {
    if (workspaces) {
      for (const workspace of workspaces) {
        const pa = Uri.parse(workspace.uri).fsPath;
        this.folders.push({
          root: pa,
          dotabapgit: undefined,
          starting: pa});
      }
    }

    for (const folder of this.folders) {
      const name = folder.root + path.sep + ".abapgit.xml";
      try {
        const xml = fs.readFileSync(name, "utf-8");
        folder.dotabapgit = name;
        const result = xml.match(/<STARTING_FOLDER>([\w\/]+)<\/STARTING_FOLDER>/);

        if (result) {
          folder.starting = folder.root + result[1];
        }
      } catch {
        this.connection.console.log("no .abapgit.xml found, " + name);
      }
    }

    this.connection.console.log("Folder overview:");
    for (const folder of this.folders) {
      this.connection.console.log(folder.root + " " + folder.dotabapgit + " " + folder.starting);
    }
  }

  private readConfig() {
// todo, multi folder vs config?
    try {
      if (this.folders.length > 0) {
        const name = this.folders[0].root + path.sep + "abaplint.json";
        const raw = fs.readFileSync(name, "utf-8"); // todo, rootPath is deprecated
        const config = new abaplint.Config(raw);
        this.reg.setConfig(config);
        this.connection.console.log("custom abaplint.json found");
        this.configInfo = name;
      }
    } catch {
      this.configInfo = "default";
      this.connection.console.log("no custom abaplint config, using defaults");
    }
  }

  public onDocumentSymbol(params: LServer.DocumentSymbolParams): LServer.DocumentSymbol[] {
    const symbols = new abaplint.LanguageServer(this.reg).documentSymbol(params);
//    this.connection.console.log("symbols count: " + symbols.length);
    return symbols;
  /*
  const symbol: LServer.SymbolInformation = {
    name: "class_name",
    kind: LServer.SymbolKind.Class,
    location: LServer.Location.create(params.textDocument.uri, LServer.Range.create(10, 0, 20, 0))};
  const prop: LServer.SymbolInformation = {
    name: "method_name",
    kind: LServer.SymbolKind.Method,
    location: LServer.Location.create(params.textDocument.uri, LServer.Range.create(12, 0, 13, 0)),
    containerName: "class_name"};
  return [symbol, prop];
  */
  }

}