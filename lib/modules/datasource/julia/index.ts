import upath from 'upath';
import { GlobalConfig } from '../../../config/global.ts';
import { logger } from '../../../logger/index.ts';
import * as memCache from '../../../util/cache/memory/index.ts';
import { withCache } from '../../../util/cache/package/with-cache.ts';
import { privateCacheDir, readCacheFile } from '../../../util/fs/index.ts';
import { createSimpleGit } from '../../../util/git/index.ts';
import { toSha256 } from '../../../util/hash.ts';
import { acquireLock } from '../../../util/mutex.ts';
import { regEx } from '../../../util/regex.ts';
import { parse as parseToml } from '../../../util/toml.ts';
import { parseUrl } from '../../../util/url.ts';
import { Datasource } from '../datasource.ts';
import type { GetReleasesConfig, Release, ReleaseResult } from '../types.ts';
import { JuliaPackage, JuliaPackageVersions, JuliaRegistry } from './schema.ts';

type CloneResult =
  | {
      err: Error;
      clonePath?: undefined;
    }
  | {
      clonePath: string;
      err?: undefined;
    };

export class JuliaDatasource extends Datasource {
  static readonly id = 'julia';

  constructor() {
    super(JuliaDatasource.id);
  }

  override readonly defaultRegistryUrls = [
    'https://github.com/JuliaRegistries/General',
  ];

  override readonly defaultVersioning = 'julia';

  override readonly customRegistrySupport = true;

  override readonly releaseTimestampSupport = false;

  override readonly sourceUrlSupport = 'package';

  override readonly sourceUrlNote =
    'The source URL is determined from the `repo` field in `Package.toml`.';

  private async _getReleases({
    packageName,
    registryUrl,
  }: GetReleasesConfig): Promise<ReleaseResult | null> {
    /* v8 ignore if -- should never happen */
    if (!registryUrl) {
      logger.warn(
        'julia datasource: No registryUrl specified, cannot perform getReleases',
      );
      return null;
    }

    const url = parseUrl(registryUrl);
    if (!url) {
      logger.debug(`Could not parse registry URL ${registryUrl}`);
      return null;
    }

    const clonePath = await JuliaDatasource.fetchClonePath(registryUrl, url);
    if (!clonePath) {
      return null;
    }

    let registry: JuliaRegistry;
    try {
      const content = await readCacheFile(
        upath.join(clonePath, 'Registry.toml'),
        'utf8',
      );
      registry = JuliaRegistry.parse(parseToml(content));
    } catch (err) {
      logger.debug(
        { err, registryUrl },
        'julia datasource: could not read or parse Registry.toml',
      );
      return null;
    }

    const packageEntry = Object.values(registry.packages).find(
      (entry) => entry.name === packageName,
    );
    if (!packageEntry) {
      logger.debug(
        { packageName, registryUrl },
        'julia datasource: package not found in Registry.toml',
      );
      return null;
    }

    const packagePath = upath.join(clonePath, packageEntry.path);

    let versions: JuliaPackageVersions;
    try {
      const content = await readCacheFile(
        upath.join(packagePath, 'Versions.toml'),
        'utf8',
      );
      versions = JuliaPackageVersions.parse(parseToml(content));
    } catch (err) {
      logger.debug(
        { err, packageName, registryUrl },
        'julia datasource: could not read or parse Versions.toml',
      );
      return null;
    }

    let sourceUrl: string | undefined;
    try {
      const content = await readCacheFile(
        upath.join(packagePath, 'Package.toml'),
        'utf8',
      );
      sourceUrl = JuliaPackage.parse(parseToml(content)).repo;
    } catch (err) {
      logger.debug(
        { err, packageName, registryUrl },
        'julia datasource: could not read or parse Package.toml',
      );
    }

    const releases: Release[] = Object.entries(versions).map(
      ([version, entry]) => ({
        version,
        gitRef: entry['git-tree-sha1'],
      }),
    );

    return { releases, sourceUrl };
  }

  override getReleases(
    config: GetReleasesConfig,
  ): Promise<ReleaseResult | null> {
    return withCache(
      {
        namespace: `datasource-${JuliaDatasource.id}`,
        key: `getReleases:${config.registryUrl}/${config.packageName}`,
        cacheable: true,
      },
      () => this._getReleases(config),
    );
  }

  /**
   * Given a Git URL, computes a semi-human-readable name for a folder in which
   * to clone the repository.
   */
  private static cacheDirFromUrl(url: URL): string {
    const proto = url.protocol.replace(regEx(/:$/), '');
    const host = url.hostname;
    const hash = toSha256(url.pathname).substring(0, 7);

    return `julia-registry-${proto}-${host}-${hash}`;
  }

  private static async fetchClonePath(
    registryUrl: string,
    url: URL,
  ): Promise<string | null> {
    const cacheKey = `julia-datasource/registry-clone-path/${registryUrl}`;
    const lockKey = registryUrl;

    const executionTimeout = GlobalConfig.get('executionTimeout') * 60 * 1000;
    const gitTimeout = GlobalConfig.get('gitTimeout') || executionTimeout;
    const releaseLock = await acquireLock(
      lockKey,
      'julia-registry',
      gitTimeout,
    );
    try {
      const cached = memCache.get<CloneResult>(cacheKey);

      if (cached?.err) {
        logger.warn(
          { err: cached.err, registryUrl },
          'Previous git clone failed, bailing out.',
        );
        return null;
      }

      if (cached?.clonePath) {
        return cached.clonePath;
      }

      const clonePath = upath.join(
        privateCacheDir(),
        JuliaDatasource.cacheDirFromUrl(url),
      );

      const result = await JuliaDatasource.clone(registryUrl, clonePath);

      memCache.set(cacheKey, result);

      if (result.err) {
        logger.warn(
          { err: result.err, registryUrl },
          'Git clone failed, bailing out.',
        );
        return null;
      }

      return result.clonePath;
    } finally {
      releaseLock();
    }
  }

  private static async clone(
    registryFetchUrl: string,
    clonePath: string,
  ): Promise<CloneResult> {
    logger.info({ clonePath, registryFetchUrl }, `Cloning Julia registry`);

    const git = createSimpleGit({
      config: { maxConcurrentProcesses: 1 },
    });

    try {
      await git.clone(registryFetchUrl, clonePath, {
        '--depth': 1,
      });
      return { clonePath };
    } catch (err) {
      if (
        err.message.includes(
          'fatal: dumb http transport does not support shallow capabilities',
        )
      ) {
        logger.info(
          { registryFetchUrl },
          'failed to shallow clone Julia registry, doing full clone',
        );
        try {
          await git.clone(registryFetchUrl, clonePath);
          return { clonePath };
        } catch (err) {
          logger.warn(
            { err, registryFetchUrl },
            'failed cloning Julia registry',
          );
          return { err };
        }
      } else {
        logger.warn({ err, registryFetchUrl }, 'failed cloning Julia registry');
        return { err };
      }
    }
  }
}
