import fs from 'fs-extra';
import type { SimpleGit } from 'simple-git';
import { setTimeout } from 'timers/promises';
import type { DirectoryResult } from 'tmp-promise';
import { dir } from 'tmp-promise';
import upath from 'upath';
import type { MockedFunction } from 'vitest';
import { Fixtures } from '~test/fixtures.ts';
import { partial } from '~test/util.ts';
import { GlobalConfig } from '../../../config/global.ts';
import type { RepoGlobalConfig } from '../../../config/types.ts';
import * as memCache from '../../../util/cache/memory/index.ts';
import * as git from '../../../util/git/index.ts';
import { getPkgReleases } from '../index.ts';
import { JuliaDatasource } from './index.ts';

vi.unmock('../../../util/mutex.ts');
const createSimpleGit = vi.mocked(git.createSimpleGit);

const datasource = JuliaDatasource.id;

function writeRegistry(
  clonePath: string,
  options: {
    registry?: string;
    packagePath?: string;
    versions?: string;
    pkg?: string;
  } = {},
): void {
  const {
    registry = 'Registry.toml',
    packagePath = 'E/Example',
    versions = 'Example_Versions.toml',
    pkg = 'Example_Package.toml',
  } = options;
  fs.mkdirSync(clonePath, { recursive: true });
  fs.writeFileSync(
    upath.join(clonePath, 'Registry.toml'),
    Fixtures.get(registry),
    { encoding: 'utf8' },
  );
  const pkgDir = upath.join(clonePath, packagePath);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    upath.join(pkgDir, 'Versions.toml'),
    Fixtures.get(versions),
    {
      encoding: 'utf8',
    },
  );
  fs.writeFileSync(upath.join(pkgDir, 'Package.toml'), Fixtures.get(pkg), {
    encoding: 'utf8',
  });
}

function setupGitMocks(
  options: Parameters<typeof writeRegistry>[1] = {},
  delayMs?: number,
): { mockClone: MockedFunction<SimpleGit['clone']> } {
  const mockClone = vi
    .fn()
    .mockName('clone')
    .mockImplementation(
      async (_registryUrl: string, clonePath: string, _opts) => {
        if (delayMs && delayMs > 0) {
          await setTimeout(delayMs);
        }
        writeRegistry(clonePath, options);
      },
    );

  const gitMock = partial<SimpleGit>({ clone: mockClone });
  createSimpleGit.mockReturnValue(gitMock);
  return { mockClone };
}

function setupEmptyGitMock(): {
  mockClone: MockedFunction<SimpleGit['clone']>;
} {
  const mockClone = vi
    .fn()
    .mockName('clone')
    .mockImplementation((_registryUrl: string, clonePath: string) => {
      fs.mkdirSync(clonePath, { recursive: true });
    });
  const gitMock = partial<SimpleGit>({ clone: mockClone });
  createSimpleGit.mockReturnValue(gitMock);
  return { mockClone };
}

function setupErrorGitMock(): {
  mockClone: MockedFunction<SimpleGit['clone']>;
} {
  const mockClone = vi
    .fn()
    .mockName('clone')
    .mockImplementation(() => Promise.reject(new Error('mocked error')));

  const gitMock = partial<SimpleGit>({ clone: mockClone });
  createSimpleGit.mockReturnValue(gitMock);
  return { mockClone };
}

describe('modules/datasource/julia/index', () => {
  let tmpDir: DirectoryResult | null;
  let adminConfig: RepoGlobalConfig;

  beforeEach(async () => {
    tmpDir = await dir({ unsafeCleanup: true });

    adminConfig = {
      localDir: upath.join(tmpDir.path, 'local'),
      cacheDir: upath.join(tmpDir.path, 'cache'),
    };
    GlobalConfig.set(adminConfig);

    createSimpleGit.mockReset();
    memCache.init();
  });

  afterEach(async () => {
    await tmpDir?.cleanup();
    tmpDir = null;
    GlobalConfig.reset();
  });

  it('returns null for invalid registry url', async () => {
    expect(
      await getPkgReleases({
        datasource,
        packageName: 'Example',
        registryUrls: ['not a url'],
      }),
    ).toBeNull();
  });

  it('returns releases for the Example fixture using the default registry url', async () => {
    setupGitMocks();
    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(res).not.toBeNull();
    expect(res?.registryUrl).toBe('https://github.com/JuliaRegistries/General');
    expect(res?.sourceUrl).toBe('https://github.com/JuliaLang/Example.jl');
    expect(res?.releases).toEqual([
      { version: '0.5.3', gitRef: '46e44e869b4d90b96bd8ed1fdcf32244fddfb6cc' },
      { version: '0.5.4', gitRef: '11820aa9c229fd3833d4bd69e5e75ef4e7273bf1' },
      { version: '0.5.5', gitRef: 'e1f0e1a832ccd8e97d6d0348dec33ee139a5aeaf' },
    ]);
  });

  it('uses a custom registry url', async () => {
    setupGitMocks();
    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
      registryUrls: ['https://example.com/my-julia-registry'],
    });
    expect(res).not.toBeNull();
    expect(res?.releases).toHaveLength(3);
  });

  it('returns null when the package is not in the registry', async () => {
    setupGitMocks();
    const res = await getPkgReleases({
      datasource,
      packageName: 'Nonexistent',
    });
    expect(res).toBeNull();
  });

  it('returns null when Registry.toml is missing', async () => {
    setupEmptyGitMock();
    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(res).toBeNull();
  });

  it('returns null when Versions.toml is missing', async () => {
    const mockClone = vi
      .fn()
      .mockName('clone')
      .mockImplementation((_registryUrl: string, clonePath: string) => {
        fs.mkdirSync(clonePath, { recursive: true });
        fs.writeFileSync(
          upath.join(clonePath, 'Registry.toml'),
          Fixtures.get('Registry.toml'),
          { encoding: 'utf8' },
        );
      });
    const gitMock = partial<SimpleGit>({ clone: mockClone });
    createSimpleGit.mockReturnValue(gitMock);

    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(res).toBeNull();
  });

  it('returns releases without sourceUrl when Package.toml is missing', async () => {
    const mockClone = vi
      .fn()
      .mockName('clone')
      .mockImplementation((_registryUrl: string, clonePath: string) => {
        fs.mkdirSync(clonePath, { recursive: true });
        fs.writeFileSync(
          upath.join(clonePath, 'Registry.toml'),
          Fixtures.get('Registry.toml'),
          { encoding: 'utf8' },
        );
        const pkgDir = upath.join(clonePath, 'E/Example');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          upath.join(pkgDir, 'Versions.toml'),
          Fixtures.get('Example_Versions.toml'),
          { encoding: 'utf8' },
        );
      });
    const gitMock = partial<SimpleGit>({ clone: mockClone });
    createSimpleGit.mockReturnValue(gitMock);

    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(res).not.toBeNull();
    expect(res?.sourceUrl).toBeUndefined();
    expect(res?.releases).toHaveLength(3);
  });

  it('clones once then reuses the cache for subsequent packages', async () => {
    const mockClone = vi
      .fn()
      .mockName('clone')
      .mockImplementation((_registryUrl: string, clonePath: string, _opts) => {
        writeRegistry(clonePath);
        const jsonDir = upath.join(clonePath, 'J/JSON');
        fs.mkdirSync(jsonDir, { recursive: true });
        fs.writeFileSync(
          upath.join(jsonDir, 'Versions.toml'),
          Fixtures.get('Example_Versions.toml'),
          { encoding: 'utf8' },
        );
        fs.writeFileSync(
          upath.join(jsonDir, 'Package.toml'),
          Fixtures.get('Example_Package.toml'),
          { encoding: 'utf8' },
        );
      });
    const gitMock = partial<SimpleGit>({ clone: mockClone });
    createSimpleGit.mockReturnValue(gitMock);

    const res1 = await getPkgReleases({ datasource, packageName: 'Example' });
    const res2 = await getPkgReleases({ datasource, packageName: 'JSON' });
    expect(res1).not.toBeNull();
    expect(res2).not.toBeNull();
    expect(mockClone).toHaveBeenCalledTimes(1);
  });

  it('guards against race conditions while cloning', async () => {
    const { mockClone } = setupGitMocks({}, 250);
    await Promise.all([
      getPkgReleases({ datasource, packageName: 'Example' }),
      getPkgReleases({ datasource, packageName: 'Example' }),
    ]);
    expect(mockClone).toHaveBeenCalledTimes(1);
  });

  it('returns null when git clone fails', async () => {
    setupErrorGitMock();
    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    const res2 = await getPkgReleases({
      datasource,
      packageName: 'JSON',
    });
    expect(res).toBeNull();
    expect(res2).toBeNull();
  });

  it('retries if shallow fails because of a dumb http git repo', async () => {
    const mockClone = vi
      .fn()
      .mockName('clone')
      .mockImplementation((_registryUrl: string, clonePath: string, opts) => {
        if (typeof opts !== 'undefined' && Object.hasOwn(opts, '--depth')) {
          return Promise.reject(
            new Error(
              'fatal: dumb http transport does not support shallow capabilities',
            ),
          );
        }
        writeRegistry(clonePath);
      });
    const gitMock = partial<SimpleGit>({ clone: mockClone });
    createSimpleGit.mockReturnValue(gitMock);

    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(mockClone).toHaveBeenCalledTimes(2);
    expect(res).not.toBeNull();
  });

  it('retries if shallow fails but retry can also fail', async () => {
    const mockClone = vi
      .fn()
      .mockName('clone')
      .mockImplementation((_registryUrl: string, _clonePath: string, opts) => {
        if (typeof opts !== 'undefined' && Object.hasOwn(opts, '--depth')) {
          return Promise.reject(
            new Error(
              'fatal: dumb http transport does not support shallow capabilities',
            ),
          );
        }
        return Promise.reject(new Error('mocked error'));
      });
    const gitMock = partial<SimpleGit>({ clone: mockClone });
    createSimpleGit.mockReturnValue(gitMock);

    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(mockClone).toHaveBeenCalledTimes(2);
    expect(res).toBeNull();
  });

  it('respects the explicit gitTimeout setting', async () => {
    const { mockClone } = setupGitMocks();
    GlobalConfig.set({ ...adminConfig, gitTimeout: 30000 });
    const res = await getPkgReleases({
      datasource,
      packageName: 'Example',
    });
    expect(mockClone).toHaveBeenCalled();
    expect(res).not.toBeNull();
  });
});
