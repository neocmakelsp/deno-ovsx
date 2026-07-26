import {
  BlobReader,
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipReader,
  ZipWriter,
} from "@zip-js/zip-js";

import type { Entry } from "@zip-js/zip-js";
import * as path from "@std/path";

import { exists, walk } from "@std/fs";
import * as xml from "@libs/xml";
import { XMLContentTypesDefault } from "./package/content_types.ts";
import { type JsonInfo, projectDirReader } from "./package/json_reader.ts";
import { genXmlvsixMinifest } from "./package/vsixmanifest.ts";
import { build_extension } from "./package/esbuild.ts";
import * as parser from "@cfa/gitignore-parser";
import { warn } from "@std/log";
import {
  defaultMimetypes,
  type XMLContentTypes,
} from "./package/content_types.ts";
import { contentType } from "@std/media-types";
const excludeDirs = [
  /\/src$/,
  /\/node_modules$/,
  /src$/,
  /node_modules$/,
  /deno.json/,
  /deno.lock/,
  /.*\.vsix/,
  /.git/,
  /.vscodeignore/,
  /readme.md/,
  /README.md/,
];

const DECODE = new TextDecoder("utf-8");
const CONTENT_TYPES_FILE = "[Content_Types].xml";

const VSIX_MANIFEST = "extension.vsixmanifest";

const README = "readme.md";

const LINK_REGEX = /(!?)\[([^\]\[]*|!\[[^\]\[]*]\([^\)]+\))\]\(([^\)]+)\)/g;

const README_FILES = ["README.md", "readme.md"];

const PACKAGE_JSON = "package.json";

export interface PackageInfo {
  fileName: string;
  entries: Entry[];
}

export async function createVSIX(
  dir_entry: string,
): Promise<PackageInfo | undefined> {
  const info = await projectDirReader(
    new URL("file://" + path.resolve(dir_entry)),
  );
  if (!info) {
    warn("no vscode_package.json found");
    return;
  }
  await build_extension(dir_entry, info);
  return await packageVSIX(dir_entry, info);
}

type Optional<T> = T | undefined;

async function readReadme(dir_entry: string): Promise<Optional<string>> {
  for (const readme of README_FILES) {
    const readme_path = path.join(dir_entry, readme);
    if (!await exists(readme_path)) {
      continue;
    }
    const data = await Deno.readFile(readme_path);
    return DECODE.decode(data);
  }
}
async function genPackageJson(
  dir_entry: string,
): Promise<Optional<string>> {
  const dir_path = path.resolve(dir_entry);
  const vscodeJson = path.join(dir_path, "vscode_package.json");
  if (!await exists(vscodeJson)) {
    warn("Cannot find vscode_package.json");
    return undefined;
  }
  const denoJson = path.join(dir_path, "deno.json");
  if (!await exists(denoJson)) {
    warn("Cannot find deno.json");
    return undefined;
  }
  const vscodeUrl = new URL("file://" + vscodeJson);
  const denoUrl = new URL("file://" + denoJson);
  const responseVscode = await fetch(vscodeUrl);
  if (!responseVscode.ok) {
    warn("error: ", responseVscode.statusText);
    return undefined;
  }
  const vscodeData = await responseVscode.json();
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
  vscodeData["version"] = version;
  return JSON.stringify(vscodeData, null, 2);
}

async function rewriteReadme(
  dir_entry: string,
  dir_info: JsonInfo,
): Promise<Optional<string>> {
  const readme_content = await readReadme(dir_entry);
  if (!readme_content) {
    return;
  }
  let url = undefined;
  if (typeof dir_info.url == "string") {
    url = dir_info.url;
  } else {
    url = dir_info.url?.url;
  }
  if (!url) {
    return;
  }
  const url_link = new URL(url);
  const protocol = url_link.protocol;
  const hostname = url_link.hostname;
  const pathname = url_link.pathname;
  const urlReplace = (
    origin: string,
    isImage: string,
    title: string,
    link: string,
  ) => {
    if (/^mailto:/i.test(link)) {
      return origin;
    }

    if (/^http:/i.test(link)) {
      return origin;
    }

    if (/^https:/i.test(link)) {
      return origin;
    }

    if (isImage == "") {
      return origin;
    }

    title = title.replace(LINK_REGEX, urlReplace);
    const prefix = path.join(hostname, pathname, "raw", "HEAD");

    const result = `${isImage}[${title}](${
      protocol + "//" + path.join(prefix, path.normalize(link))
    })`;

    return result;
  };
  const replace_content = readme_content.replace(LINK_REGEX, urlReplace);
  return replace_content;
}

async function packageVSIX(
  dir_entry: string,
  dir_info: JsonInfo,
): Promise<PackageInfo | undefined> {
  const zipFileWriter: BlobWriter = new BlobWriter();

  const zipWriter = new ZipWriter(zipFileWriter, {
    extendedTimestamp: false,
  });
  const packageData = await genPackageJson(dir_entry);

  if (!packageData) {
    return undefined;
  }
  const packageReader = new TextReader(packageData);
  zipWriter.add(PACKAGE_JSON, packageReader);

  const xmlContentTypes = XMLContentTypesDefault;

  const fileName = `${dir_info.name}-${dir_info.version}.vsix`;

  const xmlVisxData = xml.stringify(genXmlvsixMinifest(dir_info));
  const xmlVisxReader = new TextReader(xmlVisxData);

  zipWriter.add(VSIX_MANIFEST, xmlVisxReader);

  const rewriteContent = await rewriteReadme(dir_entry, dir_info);
  if (rewriteContent) {
    const readmeData = new TextReader(rewriteContent);
    zipWriter.add(path.join("extension", README), readmeData);
  }

  await walkFileFilited(dir_entry, dir_info.main, zipWriter, xmlContentTypes);

  // deno-lint-ignore no-explicit-any
  const contentTypeData = xml.stringify(xmlContentTypes as any);

  const contentTypeReader = new TextReader(contentTypeData);

  zipWriter.add(CONTENT_TYPES_FILE, contentTypeReader);
  zipWriter.close();

  const zipFileBlob: Blob = await zipFileWriter.getData();

  const zipFileReader = new BlobReader(zipFileBlob);
  const zipReader = new ZipReader(zipFileReader);
  const entries = await zipReader.getEntries();
  await zipReader.close();

  await Deno.writeFile(fileName, zipFileBlob.stream());

  return { fileName, entries };
}

async function walkFileFilited(
  dir: string,
  main: string,
  zipWriter: ZipWriter<Blob>,
  xml_content_types: XMLContentTypes,
) {
  const normal_main = path.normalize(main);
  let ignore_parser = undefined;
  const vscode_gitignore = path.join(dir, ".vscodeignore");
  if (await exists(vscode_gitignore)) {
    const data = await Deno.readFile(vscode_gitignore);

    ignore_parser = parser.compile(DECODE.decode(data));
  }
  const mime_types = defaultMimetypes;
  for await (
    const entry of walk(dir, { includeDirs: true, skip: excludeDirs })
  ) {
    if (entry.isFile) {
      const filepath = path.relative(dir, entry.path);
      const data = await Deno.readFile(entry.path);
      const fileReader = new Uint8ArrayReader(data);

      if (
        ignore_parser && ignore_parser.denies(filepath) &&
        path.normalize(filepath) != normal_main
      ) {
        continue;
      }
      const ext = path.extname(filepath);
      if (ext != "") {
        const content_type = contentType(ext);
        if (content_type) {
          mime_types.set(ext, content_type);
        }
      }
      if (entry.name == "LICENSE") {
        await zipWriter.add("extension/LICENSE.txt", fileReader);
      } else {
        await zipWriter.add(`extension/${filepath}`, fileReader);
      }
    }
  }
  for (const [extension, contentType] of mime_types) {
    xml_content_types.push_ext({
      "@Extension": extension,
      "@ContentType": contentType,
    });
  }
}
