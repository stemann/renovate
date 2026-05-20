import { logger } from '../../../logger/index.ts';
import type { SkipReason } from '../../../types/index.ts';
import { regEx } from '../../../util/regex.ts';
import { AzureTagsDatasource } from '../../datasource/azure-tags/index.ts';
import { BitbucketTagsDatasource } from '../../datasource/bitbucket-tags/index.ts';
import { ForgejoTagsDatasource } from '../../datasource/forgejo-tags/index.ts';
import { GitTagsDatasource } from '../../datasource/git-tags/index.ts';
import { GiteaTagsDatasource } from '../../datasource/gitea-tags/index.ts';
import { GithubReleasesDatasource } from '../../datasource/github-releases/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';
import { GitlabReleasesDatasource } from '../../datasource/gitlab-releases/index.ts';
import { GitlabTagsDatasource } from '../../datasource/gitlab-tags/index.ts';
import type { PackageDependency, PackageFileContent } from '../types.ts';

interface BinaryBuilderManagerData {
  hash: string;
  sourceType: 'ArchiveSource' | 'FileSource' | 'GitSource';
}

const nameLiteralRegex = regEx(/^\s*name\s*=\s*"(?<name>[^"\n]+)"/m);
const versionLiteralRegex = regEx(/^\s*version\s*=\s*v"(?<version>[^"\n]+)"/m);

// Match `ArchiveSource("url", "hash"[, ...])`, `FileSource(...)`,
// `GitSource(...)`. The DSL accepts both double-quoted strings and
// (rarely) raw string literals, but we restrict to plain quoted strings
// since that is the convention across Yggdrasil. Constructor invocations
// may span multiple lines and may carry trailing whitespace, so we use
// `\s*` between tokens. A fresh `RegExp` is constructed on each call to
// avoid `lastIndex` state leaking between invocations.
const sourceCallPattern =
  '(?<ctor>ArchiveSource|FileSource|GitSource)\\s*\\(\\s*"(?<url>[^"\\n]+)"\\s*,\\s*"(?<hash>[0-9a-fA-F]+)"';

const githubReleaseRegex = regEx(
  /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/releases\/download\/(?<tag>[^/]+)\//,
);
const githubArchiveTagRegex = regEx(
  /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/archive\/refs\/tags\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);
const githubGitRegex = regEx(
  /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)\.git$/,
);

// GitLab archive and release URLs use the fixed `/-/archive/` and
// `/-/releases/` path layout on every GitLab instance, so the hostname can
// stay open (gitlab.com, gitlab.gnome.org, gitlab.freedesktop.org, etc.).
// `.git` URLs are hostname-pinned for the known public forges; everything
// else falls through to `git-tags` so tag discovery still works.
const gitlabArchiveTagRegex = regEx(
  /^https?:\/\/(?<host>[^/]+)\/(?<path>.+?)\/-\/archive\/(?<tag>[^/]+)\/[^/]+\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);
const gitlabReleaseRegex = regEx(
  /^https?:\/\/(?<host>[^/]+)\/(?<path>.+?)\/-\/releases\/(?<tag>[^/]+)\/downloads\//,
);
const gitlabGitRegex = regEx(/^https?:\/\/gitlab\.com\/(?<path>.+?)\.git$/);

// Gitea/Forgejo (Codeberg) and Bitbucket auto-archive URL formats. Gitea
// and Forgejo share the GitHub-style `/archive/<tag>.<ext>` path layout
// (Forgejo is a Gitea fork). Bitbucket uses `/get/<tag>.<ext>`.
const codebergArchiveRegex = regEx(
  /^https?:\/\/codeberg\.org\/(?<path>[^/]+\/[^/]+)\/archive\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);
const giteaComArchiveRegex = regEx(
  /^https?:\/\/gitea\.com\/(?<path>[^/]+\/[^/]+)\/archive\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);
const bitbucketArchiveRegex = regEx(
  /^https?:\/\/bitbucket\.org\/(?<path>[^/]+\/[^/]+)\/get\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);

// Self-hosted Gitea/Forgejo are matched by a hostname-subdomain
// convention (`gitea.<domain>` or `forgejo.<domain>`). Hosts that run
// Gitea/Forgejo under a non-conventional name (e.g. `git.example.com`,
// `code.example.com`) carry no reliable signal and need an explicit
// `packageRules` override.
const giteaSelfHostedArchiveRegex = regEx(
  /^https?:\/\/(?<host>gitea\.[^/]+)\/(?<path>[^/]+\/[^/]+)\/archive\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);
const forgejoSelfHostedArchiveRegex = regEx(
  /^https?:\/\/(?<host>forgejo\.[^/]+)\/(?<path>[^/]+\/[^/]+)\/archive\/(?<tag>[^/]+?)\.(?:tar\.gz|tar\.bz2|tar\.xz|zip)$/,
);

const codebergGitRegex = regEx(/^https?:\/\/codeberg\.org\/(?<path>.+?)\.git$/);
const giteaComGitRegex = regEx(/^https?:\/\/gitea\.com\/(?<path>.+?)\.git$/);
const bitbucketGitRegex = regEx(
  /^https?:\/\/bitbucket\.org\/(?<path>.+?)\.git$/,
);
const giteaSelfHostedGitRegex = regEx(
  /^https?:\/\/(?<host>gitea\.[^/]+)\/(?<path>.+?)\.git$/,
);
const forgejoSelfHostedGitRegex = regEx(
  /^https?:\/\/(?<host>forgejo\.[^/]+)\/(?<path>.+?)\.git$/,
);

// Azure DevOps Repos. Both the modern `dev.azure.com/<org>/...` form and
// the legacy `<org>.visualstudio.com/...` form are recognised; both URL
// schemes resolve to the same backend so either works as a registry URL.
// The `.git` suffix is optional.
const azureDevopsGitRegex = regEx(
  /^https?:\/\/dev\.azure\.com\/(?<org>[^/]+)\/(?<project>[^/]+)\/_git\/(?<repo>[^/]+?)(?:\.git)?$/,
);
const azureLegacyGitRegex = regEx(
  /^https?:\/\/(?<org>[^./]+)\.visualstudio\.com\/(?<project>[^/]+)\/_git\/(?<repo>[^/]+?)(?:\.git)?$/,
);

// Generic fallback: any other http(s) `.git` URL maps to `git-tags`, which
// uses `git ls-remote` to enumerate tags from the remote. Tags don't move,
// so this does not introduce HEAD-following behaviour.
const genericGitRegex = regEx(/^https?:\/\/.+\.git$/);

// SSH git URL forms: `git@<host>:<path>[.git]` (classic) and
// `ssh://git@<host>/<path>[.git]` (protocol form). Recognised mainly for
// completeness; build_tarballs.jl recipes typically use https because the
// BB sandbox has no SSH keys configured.
const sshGitRegex = regEx(
  /^(?:ssh:\/\/)?git@(?<host>[^:/]+)[:/](?<path>.+?)(?:\.git)?$/,
);

// Azure DevOps SSH URLs use a different host and path layout than the
// HTTPS form (`ssh.dev.azure.com:v3/<org>/<project>/<repo>` modern,
// `<org>@vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` legacy), so
// generic SSH→HTTPS normalisation would produce the wrong URL. These
// must be matched directly and remapped to the corresponding
// `dev.azure.com` or `<org>.visualstudio.com` HTTPS registry URL.
// See https://learn.microsoft.com/azure/devops/repos/git/use-ssh-keys-to-authenticate.
const azureSshModernRegex = regEx(
  /^(?:ssh:\/\/)?[^@]+@ssh\.dev\.azure\.com[:/]v3\/(?<org>[^/]+)\/(?<project>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
);
const azureSshLegacyRegex = regEx(
  /^(?:ssh:\/\/)?[^@]+@vs-ssh\.visualstudio\.com[:/]v3\/(?<org>[^/]+)\/(?<project>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
);

function isValidHash(
  hash: string,
  sourceType: BinaryBuilderManagerData['sourceType'],
): boolean {
  const len = hash.length;
  // GitSource pins to a 40-hex SHA1 commit.
  if (sourceType === 'GitSource') {
    return len === 40;
  }
  // ArchiveSource and FileSource accept SHA1 (40), SHA256 (64), SHA384 (96),
  // and SHA512 (128) hex strings. The algorithm is inferred from the hex
  // length at hash-recompute time.
  return len === 40 || len === 64 || len === 96 || len === 128;
}

interface UrlClassification {
  datasource?: string;
  packageName?: string;
  registryUrls?: string[];
  currentValue?: string;
  skipReason?: SkipReason;
}

function classifyArchiveOrFileUrl(url: string): UrlClassification {
  const release = githubReleaseRegex.exec(url);
  if (release?.groups) {
    const { owner, repo, tag } = release.groups;
    return {
      datasource: GithubReleasesDatasource.id,
      packageName: `${owner}/${repo}`,
      currentValue: tag,
    };
  }

  const archive = githubArchiveTagRegex.exec(url);
  if (archive?.groups) {
    const { owner, repo, tag } = archive.groups;
    return {
      datasource: GithubTagsDatasource.id,
      packageName: `${owner}/${repo}`,
      currentValue: tag,
    };
  }

  const glArchive = gitlabArchiveTagRegex.exec(url);
  if (glArchive?.groups) {
    const { host, path, tag } = glArchive.groups;
    return {
      datasource: GitlabTagsDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
      currentValue: tag,
    };
  }

  const glRelease = gitlabReleaseRegex.exec(url);
  if (glRelease?.groups) {
    const { host, path, tag } = glRelease.groups;
    return {
      datasource: GitlabReleasesDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
      currentValue: tag,
    };
  }

  const codebergArchive = codebergArchiveRegex.exec(url);
  if (codebergArchive?.groups) {
    const { path, tag } = codebergArchive.groups;
    return {
      datasource: ForgejoTagsDatasource.id,
      packageName: path,
      registryUrls: ['https://codeberg.org'],
      currentValue: tag,
    };
  }

  const giteaArchive = giteaComArchiveRegex.exec(url);
  if (giteaArchive?.groups) {
    const { path, tag } = giteaArchive.groups;
    return {
      datasource: GiteaTagsDatasource.id,
      packageName: path,
      registryUrls: ['https://gitea.com'],
      currentValue: tag,
    };
  }

  const bbArchive = bitbucketArchiveRegex.exec(url);
  if (bbArchive?.groups) {
    const { path, tag } = bbArchive.groups;
    return {
      datasource: BitbucketTagsDatasource.id,
      packageName: path,
      currentValue: tag,
    };
  }

  const giteaSelfHosted = giteaSelfHostedArchiveRegex.exec(url);
  if (giteaSelfHosted?.groups) {
    const { host, path, tag } = giteaSelfHosted.groups;
    return {
      datasource: GiteaTagsDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
      currentValue: tag,
    };
  }

  const forgejoSelfHosted = forgejoSelfHostedArchiveRegex.exec(url);
  if (forgejoSelfHosted?.groups) {
    const { host, path, tag } = forgejoSelfHosted.groups;
    return {
      datasource: ForgejoTagsDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
      currentValue: tag,
    };
  }

  return { skipReason: 'unsupported-url' };
}

function classifyGitUrl(url: string): UrlClassification {
  // Azure DevOps SSH URLs need dedicated handling because the SSH and
  // HTTPS forms diverge in both hostname and path layout; generic SSH
  // normalisation would produce a wrong URL. Check these before the
  // generic SSH normaliser below.
  const azureSshModern = azureSshModernRegex.exec(url);
  if (azureSshModern?.groups) {
    const { org, project, repo } = azureSshModern.groups;
    return {
      datasource: AzureTagsDatasource.id,
      packageName: `${project}/${repo}`,
      registryUrls: [`https://dev.azure.com/${org}`],
    };
  }
  const azureSshLegacy = azureSshLegacyRegex.exec(url);
  if (azureSshLegacy?.groups) {
    const { org, project, repo } = azureSshLegacy.groups;
    return {
      datasource: AzureTagsDatasource.id,
      packageName: `${project}/${repo}`,
      registryUrls: [`https://${org}.visualstudio.com`],
    };
  }

  // Normalise other SSH git URLs to the equivalent https form, then re-classify.
  const sshMatch = sshGitRegex.exec(url);
  if (sshMatch?.groups) {
    const { host, path } = sshMatch.groups;
    return classifyGitUrl(`https://${host}/${path}.git`);
  }

  const githubMatch = githubGitRegex.exec(url);
  if (githubMatch?.groups) {
    const { owner, repo } = githubMatch.groups;
    return {
      datasource: GithubTagsDatasource.id,
      packageName: `${owner}/${repo}`,
    };
  }

  const gitlabMatch = gitlabGitRegex.exec(url);
  if (gitlabMatch?.groups) {
    return {
      datasource: GitlabTagsDatasource.id,
      packageName: gitlabMatch.groups.path,
      registryUrls: ['https://gitlab.com'],
    };
  }

  const codebergMatch = codebergGitRegex.exec(url);
  if (codebergMatch?.groups) {
    return {
      datasource: ForgejoTagsDatasource.id,
      packageName: codebergMatch.groups.path,
      registryUrls: ['https://codeberg.org'],
    };
  }

  const giteaMatch = giteaComGitRegex.exec(url);
  if (giteaMatch?.groups) {
    return {
      datasource: GiteaTagsDatasource.id,
      packageName: giteaMatch.groups.path,
      registryUrls: ['https://gitea.com'],
    };
  }

  const bbMatch = bitbucketGitRegex.exec(url);
  if (bbMatch?.groups) {
    return {
      datasource: BitbucketTagsDatasource.id,
      packageName: bbMatch.groups.path,
    };
  }

  const giteaSelfHosted = giteaSelfHostedGitRegex.exec(url);
  if (giteaSelfHosted?.groups) {
    const { host, path } = giteaSelfHosted.groups;
    return {
      datasource: GiteaTagsDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
    };
  }

  const forgejoSelfHosted = forgejoSelfHostedGitRegex.exec(url);
  if (forgejoSelfHosted?.groups) {
    const { host, path } = forgejoSelfHosted.groups;
    return {
      datasource: ForgejoTagsDatasource.id,
      packageName: path,
      registryUrls: [`https://${host}`],
    };
  }

  const azureMatch = azureDevopsGitRegex.exec(url);
  if (azureMatch?.groups) {
    const { org, project, repo } = azureMatch.groups;
    return {
      datasource: AzureTagsDatasource.id,
      packageName: `${project}/${repo}`,
      registryUrls: [`https://dev.azure.com/${org}`],
    };
  }

  const azureLegacyMatch = azureLegacyGitRegex.exec(url);
  if (azureLegacyMatch?.groups) {
    const { org, project, repo } = azureLegacyMatch.groups;
    return {
      datasource: AzureTagsDatasource.id,
      packageName: `${project}/${repo}`,
      registryUrls: [`https://${org}.visualstudio.com`],
    };
  }

  if (genericGitRegex.test(url)) {
    return {
      datasource: GitTagsDatasource.id,
      packageName: url,
    };
  }

  return { skipReason: 'unsupported-url' };
}

export function extractPackageFile(
  content: string,
  packageFile?: string,
): PackageFileContent | null {
  const sourceCallRegex = regEx(sourceCallPattern, 'g');
  const deps: PackageDependency<BinaryBuilderManagerData>[] = [];
  let match: RegExpExecArray | null;
  while ((match = sourceCallRegex.exec(content)) !== null) {
    /* v8 ignore next 3 -- defensive: named groups are always set */
    if (!match.groups) {
      continue;
    }
    const { ctor, url, hash } = match.groups;
    const sourceType = ctor as BinaryBuilderManagerData['sourceType'];

    if (!isValidHash(hash, sourceType)) {
      logger.debug(
        { packageFile, url, hashLength: hash.length, sourceType },
        'binarybuilder: skipping source with non-hex / wrong-length hash',
      );
      continue;
    }

    const managerData: BinaryBuilderManagerData = {
      hash,
      sourceType,
    };

    const classification =
      sourceType === 'GitSource'
        ? classifyGitUrl(url)
        : classifyArchiveOrFileUrl(url);

    if (classification.skipReason) {
      deps.push({
        depName: url,
        currentDigest: hash,
        skipReason: classification.skipReason,
        managerData,
      });
      continue;
    }

    const dep: PackageDependency<BinaryBuilderManagerData> = {
      depName: classification.packageName,
      packageName: classification.packageName,
      datasource: classification.datasource,
      currentDigest: hash,
      // Defer hash-recompute logic to a follow-up PR; until that lands,
      // surface deps on the Dependency Dashboard without producing
      // un-applicable update PRs.
      skipReason: 'unsupported-version',
      managerData,
    };
    if (classification.registryUrls) {
      dep.registryUrls = classification.registryUrls;
    }
    if (classification.currentValue) {
      dep.currentValue = classification.currentValue;
    }
    deps.push(dep);
  }

  if (deps.length === 0) {
    return null;
  }

  const result: PackageFileContent = { deps };

  const versionMatch = versionLiteralRegex.exec(content);
  if (versionMatch?.groups) {
    result.packageFileVersion = versionMatch.groups.version;
  }

  const nameMatch = nameLiteralRegex.exec(content);
  if (nameMatch?.groups) {
    logger.trace(
      { packageFile, name: nameMatch.groups.name },
      'binarybuilder: extracted recipe',
    );
  }

  return result;
}
