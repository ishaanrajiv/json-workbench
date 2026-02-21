import type { ExploreHit, PathSegment } from "../types.js";

export function getEntries(value: any): Array<[PathSegment, any]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [index, item]);
  }
  return Object.entries(value) as Array<[PathSegment, any]>;
}

export function sanitizePath(path: PathSegment[], root: any): PathSegment[] {
  const clean: PathSegment[] = [];
  let cursor = root;

  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (!isContainer(cursor) || !hasChild(cursor, segment)) {
      break;
    }
    clean.push(segment);
    cursor = cursor[segment as keyof typeof cursor];
  }

  return clean;
}

export function hasChild(container: any, key: PathSegment): boolean {
  if (Array.isArray(container)) {
    return typeof key === "number" && Number.isInteger(key) && key >= 0 && key < container.length;
  }
  return Object.prototype.hasOwnProperty.call(container, key);
}

export function isContainer(value: any): boolean {
  return Array.isArray(value) || isPlainObject(value);
}

export function isPlainObject(value: any): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function valueType(value: any): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

export function entryMeta(value: any): string {
  if (Array.isArray(value)) {
    return `array (${value.length})`;
  }
  if (isPlainObject(value)) {
    return `object (${Object.keys(value).length})`;
  }
  return `${valueType(value)} ${truncate(String(value), 22)}`;
}

export function matchesQuery(key: PathSegment, value: any, query: string): boolean {
  if (!query) {
    return false;
  }
  const lower = query.toLowerCase();
  if (String(key).toLowerCase().includes(lower)) {
    return true;
  }
  if (isContainer(value)) {
    return false;
  }
  return String(value).toLowerCase().includes(lower);
}

export function searchTree(root: any, query: string, maxResults: number): ExploreHit[] {
  const lower = query.toLowerCase();
  const hits: ExploreHit[] = [];

  walk(root, []);
  return hits;

  function walk(value: any, path: PathSegment[]) {
    if (hits.length >= maxResults) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, path.concat(index)));
      return;
    }

    if (isPlainObject(value)) {
      Object.keys(value).forEach((key) => {
        const nextPath = path.concat(key);
        if (key.toLowerCase().includes(lower) && hits.length < maxResults) {
          hits.push({ path: nextPath, preview: `key "${key}"` });
        }
        walk(value[key], nextPath);
      });
      return;
    }

    const text = String(value);
    if (text.toLowerCase().includes(lower) && hits.length < maxResults) {
      hits.push({ path, preview: `${valueType(value)} ${truncate(text, 26)}` });
    }
  }
}

export function formatPath(path: PathSegment[]): string {
  if (!path.length) {
    return "root";
  }
  return `root > ${path.map((segment) => String(segment)).join(" > ")}`;
}

export function toDotPath(path: PathSegment[]): string {
  let output = "root";
  path.forEach((segment) => {
    if (typeof segment === "number") {
      output += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      output += `.${segment}`;
    } else {
      output += `[${JSON.stringify(segment)}]`;
    }
  });
  return output;
}

export function toJsonPath(path: PathSegment[]): string {
  let output = "$";
  path.forEach((segment) => {
    if (typeof segment === "number") {
      output += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      output += `.${segment}`;
    } else {
      output += `[${JSON.stringify(segment)}]`;
    }
  });
  return output;
}

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, Math.max(0, length - 1))}...`;
}
