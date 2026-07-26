import * as path from "@std/path";

import { exists } from "@std/fs";
import { warn } from "@std/log";
import { escape } from "./utils.ts";

const PACKAGE_JSON_NAME = "vscode_package.json";
const DENO_JSON_NAME = "deno.json";
const READMES = ["README.md", "readme.md"];
const LICENSES = ["LICENSE", "LICENSE.txt"];

export interface Person {
  name: string;
  url?: string;
  email?: string;
}

export interface Translation {
  id: string;
  path: string;
}

export interface Localization {
  languageId: string;
  languageName?: string;
  localizedLanguageName?: string;
  translations: Translation[];
}

export interface Language {
  readonly id: string;
  readonly aliases?: string[];
  readonly extensions?: string[];
}

export interface Grammar {
  readonly language: string;
  readonly scopeName: string;
  readonly path: string;
}

export interface Command {
  readonly command: string;
  readonly title: string;
}

export interface Authentication {
  readonly id: string;
  readonly label: string;
}

export interface CustomEditor {
  readonly viewType: string;
  readonly priority: string;
  readonly selector: readonly {
    readonly filenamePattern?: string;
  }[];
}

export interface View {
  readonly id: string;
  readonly name: string;
}

export interface Contributions {
  readonly localizations?: Localization[];
  readonly languages?: Language[];
  readonly grammars?: Grammar[];
  readonly commands?: Command[];
  readonly authentication?: Authentication[];
  readonly customEditors?: CustomEditor[];
  readonly views?: { [location: string]: View[] };
  // deno-lint-ignore no-explicit-any
  readonly [contributionType: string]: any;
}

export type ExtensionKind = "ui" | "workspace" | "web";

export interface ManifestPackage {
  // mandatory (npm)
  name: string;
  version: string;
  engines: { vscode: string; [name: string]: string };

  // vscode
  publisher?: string;
  icon?: string;
  contributes?: Contributions;
  activationEvents?: string[];
  extensionDependencies?: string[];
  extensionPack?: string[];
  galleryBanner?: { color?: string; theme?: string };
  preview?: boolean;
  badges?: { url: string; href: string; description: string }[];
  markdown?: "github" | "standard";
  _bundling?: { [name: string]: string }[];
  _testing?: string;
  enableProposedApi?: boolean;
  enabledApiProposals?: readonly string[];
  qna?: "marketplace" | string | false;
  extensionKind?: ExtensionKind | ExtensionKind[];
  sponsor?: { url: string };

  // optional (npm)
  author?: string | Person;

  displayName?: string;
  description?: string;
  keywords?: string[];
  categories?: string[];
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  license?: string;
  contributors?: string | Person[];
  main?: string;
  browser?: string;
  repository?: string | { type?: string; url?: string };
  scripts?: { [name: string]: string };
  dependencies?: { [name: string]: string };
  devDependencies?: { [name: string]: string };
  private?: boolean;
  pricing?: string;
  files?: string[];

  // vsce
  // deno-lint-ignore no-explicit-any
  vsce?: any;
}

export interface JsonInfo {
  name: string;
  description: string;
  author: string;
  license: string;
  version: string;
  publisher: string;
  icon: string | undefined;
  changelog: string;
  categories: string[] | undefined;
  url?: {
    type?: string;
    url?: string;
  } | string;
  engine: string;
  main: string;
  tags: string[];
  pricing: string;
  contains_readme: boolean;
  contains_license: boolean;
  githubMarkdown: boolean;
}

export async function projectDirReader(
  dir_path: URL,
): Promise<JsonInfo | undefined> {
  const info = await packageJsonReader(
    dir_path,
  );
  if (!info) {
    return info;
  }
  for (const readme of READMES) {
    const readme_path = new URL(
      "file://" + path.join(dir_path.pathname, readme),
    );
    if (await exists(readme_path)) {
      info.contains_readme = true;
    }
  }
  for (const license of LICENSES) {
    const license_path = new URL(
      "file://" +
        path.join(dir_path.pathname, license),
    );
    if (await exists(license_path)) {
      info.contains_license = true;
    }
  }
  return info;
}

async function packageJsonReader(
  dir_path: URL,
): Promise<JsonInfo | undefined> {
  const vscodeUrl = new URL(
    "file://" + path.join(dir_path.pathname, PACKAGE_JSON_NAME),
  );
  const denoUrl = new URL(
    "file://" + path.join(dir_path.pathname, DENO_JSON_NAME),
  );
  const responseDeno = await fetch(denoUrl);
  if (!responseDeno.ok) {
    warn("error: ", responseDeno.statusText);
    return undefined;
  }
  const denoData = await responseDeno.json();
  const version = denoData["version"];
  if (typeof version != "string") {
    warn("error: version field does not exist in deno.json");
    return undefined;
  }
  let changelog: ChangeLog;
  if (await exists(path.join(dir_path, "CHANGELOG.md"))) {
    changelog = "extension/CHANGELOG.md";
  } else if (await exists(path.join(dir_path, "changelog.md"))) {
    changelog = "extension/changelog.md";
  } else {
    warn("We need a changelog");
    return;
  }
  const response = await fetch(vscodeUrl);
  if (!response.ok) {
    return undefined;
  }
  const data = await response.json() as ManifestPackage;
  data.version = version;
  return packageMainData(data, changelog);
}

type ChangeLog = "extension/CHANGELOG.md" | "extension/changelog.md";

function packageMainData(
  data: ManifestPackage,
  changelog: ChangeLog,
): JsonInfo | undefined {
  const name = data.name;
  const description = data.description || "";
  let author = "";
  if (data.author) {
    if (typeof data.author == "string") {
      author = data.author;
    } else {
      author = data.author.name;
    }
  }
  const license = data.license || "Unknown";
  const version = data.version;
  const publisher = data.publisher || "Unknown";
  const icon = data.icon;
  const categories = data.categories;
  const url = data.repository;
  const engine = data["engines"]["vscode"] as string;
  const main = data["main"] as string;

  const tags: string[] = [];
  if (
    data.contributes !== undefined &&
    data.contributes["debuggers"] !== undefined
  ) {
    tags.push("debuggers");
  }
  if (
    data.contributes !== undefined &&
    data.contributes.languages !== undefined
  ) {
    const lg = data.contributes.languages;
    for (const l of lg) {
      tags.push(escape(l.id));
      if (!l.aliases) {
        continue;
      }
      for (const alias of l.aliases) {
        tags.push(escape(alias));
      }
    }
  }
  const pricing = data.pricing || "Free";
  const githubMarkdown = data.markdown !== "standard";
  return {
    name,
    description,
    author,
    license,
    version,
    publisher,
    icon,
    changelog,
    categories,
    url,
    engine,
    main,
    tags,
    contains_readme: false,
    contains_license: false,
    pricing,
    githubMarkdown,
  };
}
