import { logger } from '../../../logger/index.ts';
import { regEx } from '../../../util/regex.ts';
import { BitbucketTagsDatasource } from '../../datasource/bitbucket-tags/index.ts';
import { GitRefsDatasource } from '../../datasource/git-refs/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';
import { GitlabTagsDatasource } from '../../datasource/gitlab-tags/index.ts';
import type { PackageDependency, PackageFileContent } from '../types.ts';

// Matches a `vcpkg_from_<kind>(...)` call. The body is captured non-greedily
// up to the matching closing paren on its own line; portfiles in the wild use
// this form consistently.
const macroCallRegex = regEx(
  /\bvcpkg_from_(github|gitlab|bitbucket|git|sourceforge)\s*\(([\s\S]*?)\)/g,
);

// Extracts a single field's value from the macro body. Values may be quoted
// or bare (a single whitespace-delimited token).
function extractField(body: string, field: string): string | undefined {
  const re = regEx(`\\b${field}\\b\\s+(?:"([^"\\n]*)"|([^\\s)]+))`);
  const m = re.exec(body);
  if (!m) {
    return undefined;
  }
  return m[1] ?? m[2];
}

function buildDep(kind: string, body: string): PackageDependency | null {
  const ref = extractField(body, 'REF');
  const sha512 = extractField(body, 'SHA512');

  const dep: PackageDependency = {
    currentValue: ref,
    currentDigest: sha512,
    // SHA512 recomputation for the upstream archive requires downloading the
    // tarball at update time. Defer to a follow-up PR; surface the dep on the
    // Dependency Dashboard rather than producing un-applicable PRs.
    skipReason: 'unsupported',
  };

  switch (kind) {
    case 'github': {
      const repo = extractField(body, 'REPO');
      if (!repo) {
        return null;
      }
      dep.depName = repo;
      dep.packageName = repo;
      dep.datasource = GithubTagsDatasource.id;
      return dep;
    }
    case 'gitlab': {
      const repo = extractField(body, 'REPO');
      if (!repo) {
        return null;
      }
      const gitlabUrl = extractField(body, 'GITLAB_URL');
      dep.depName = repo;
      dep.packageName = repo;
      dep.datasource = GitlabTagsDatasource.id;
      if (gitlabUrl) {
        dep.registryUrls = [gitlabUrl];
      }
      return dep;
    }
    case 'bitbucket': {
      const repo = extractField(body, 'REPO');
      if (!repo) {
        return null;
      }
      dep.depName = repo;
      dep.packageName = repo;
      dep.datasource = BitbucketTagsDatasource.id;
      return dep;
    }
    case 'git': {
      const url = extractField(body, 'URL');
      if (!url) {
        return null;
      }
      dep.depName = url;
      dep.packageName = url;
      dep.datasource = GitRefsDatasource.id;
      return dep;
    }
    case 'sourceforge': {
      // SourceForge has no straight Renovate datasource. Emit so the dep is
      // visible on the Dependency Dashboard, but skip the lookup.
      const repo = extractField(body, 'REPO');
      dep.depName = repo ?? 'sourceforge';
      dep.skipReason = 'unsupported-url';
      return dep;
    }
    /* v8 ignore next 2 -- exhaustive switch guard */
    default:
      return null;
  }
}

export function extractPackageFile(
  content: string,
  packageFile?: string,
): PackageFileContent | null {
  const deps: PackageDependency[] = [];
  for (const match of content.matchAll(macroCallRegex)) {
    const kind = match[1];
    const body = match[2];
    // Variable-substituted REFs (e.g. `REF ${MY_REF}`) are out of scope.
    // Skip silently; the limitation is documented in the readme.
    if (/\$\{[^}]+\}/.test(body)) {
      logger.trace(
        { packageFile, kind },
        'vcpkg-portfile: skipping macro call with variable substitution',
      );
      continue;
    }
    const dep = buildDep(kind, body);
    if (dep) {
      deps.push(dep);
    }
  }

  if (deps.length === 0) {
    return null;
  }
  return { deps };
}
