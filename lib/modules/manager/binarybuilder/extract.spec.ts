import { Fixtures } from '~test/fixtures.ts';
import { fs } from '~test/util.ts';
import { extractPackageFile } from './extract.ts';

vi.mock('../../../util/fs/index.ts');

const vanilla = Fixtures.get('build_tarballs.jl');
const githubSources = Fixtures.get('build_tarballs_github.jl');
const indirect = Fixtures.get('build_tarballs_indirect.jl');

describe('modules/manager/binarybuilder/extract', () => {
  describe('extractPackageFile()', () => {
    it('returns null for content with no source constructors', async () => {
      expect(await extractPackageFile('using BinaryBuilder\n')).toBeNull();
    });

    it('returns null for indirected recipes the regex cannot follow', async () => {
      expect(
        await extractPackageFile(indirect, 'I/Indirect/build_tarballs.jl'),
      ).toBeNull();
    });

    it('extracts ArchiveSource and GitSource from a vanilla recipe', async () => {
      const res = await extractPackageFile(
        vanilla,
        'O/OpenSSL/build_tarballs.jl',
      );
      expect(res).toEqual({
        packageFileVersion: '3.2.0',
        deps: [
          {
            depName: 'https://www.openssl.org/source/openssl-3.2.0.tar.gz',
            currentDigest:
              '14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e',
            skipReason: 'unsupported-url',
            managerData: {
              hash: '14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e',
              sourceType: 'ArchiveSource',
            },
          },
          {
            depName: 'openssl/openssl',
            packageName: 'openssl/openssl',
            datasource: 'github-tags',
            currentDigest: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
            skipReason: 'unsupported-version',
            managerData: {
              hash: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
              sourceType: 'GitSource',
            },
          },
        ],
      });
    });

    it('classifies GitHub release, GitHub archive, and arbitrary URLs', async () => {
      const res = await extractPackageFile(
        githubSources,
        'z/zlib/build_tarballs.jl',
      );
      expect(res?.packageFileVersion).toBe('1.3.1');
      expect(res?.deps).toEqual([
        {
          depName: 'madler/zlib',
          packageName: 'madler/zlib',
          datasource: 'github-releases',
          currentValue: 'v1.3.1',
          currentDigest:
            '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23',
          skipReason: 'unsupported-version',
          managerData: {
            hash: '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23',
            sourceType: 'ArchiveSource',
          },
        },
        {
          depName: 'example/foo',
          packageName: 'example/foo',
          datasource: 'github-tags',
          currentValue: 'v0.4.2',
          currentDigest:
            'ab8c1f7c1d3eaa5ab0c5edff62cd8e4be4e6b6c2a5ce9e6f9b8f7a6d5e4c3b2a',
          skipReason: 'unsupported-version',
          managerData: {
            hash: 'ab8c1f7c1d3eaa5ab0c5edff62cd8e4be4e6b6c2a5ce9e6f9b8f7a6d5e4c3b2a',
            sourceType: 'ArchiveSource',
          },
        },
        {
          depName: 'example/foo',
          packageName: 'example/foo',
          datasource: 'github-releases',
          currentValue: 'v0.4.2',
          currentDigest:
            'bc7d4e8f9a3b5c1d6e2f0a4b8c9d3e5f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
          skipReason: 'unsupported-version',
          managerData: {
            hash: 'bc7d4e8f9a3b5c1d6e2f0a4b8c9d3e5f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
            sourceType: 'FileSource',
          },
        },
        {
          depName: 'https://example.com/random/blob.tar',
          currentDigest:
            '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
          skipReason: 'unsupported-url',
          managerData: {
            hash: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
            sourceType: 'FileSource',
          },
        },
      ]);
    });

    it('classifies GitLab archive, release, and gitlab.com `.git` URLs', async () => {
      const sha = 'a'.repeat(64);
      const sha1 = 'b'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    ArchiveSource("https://gitlab.com/foo/bar/-/archive/v1.2.3/bar-v1.2.3.tar.gz", "${sha}"),`,
        `    ArchiveSource("https://gitlab.gnome.org/GNOME/glib/-/archive/2.78.4/glib-2.78.4.tar.bz2", "${sha}"),`,
        `    FileSource("https://gitlab.com/foo/bar/-/releases/v1.2.3/downloads/bar.bin", "${sha}"),`,
        `    GitSource("https://gitlab.com/foo/bar.git", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitlab-tags',
          registryUrls: ['https://gitlab.com'],
          currentValue: 'v1.2.3',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'GNOME/glib',
          packageName: 'GNOME/glib',
          datasource: 'gitlab-tags',
          registryUrls: ['https://gitlab.gnome.org'],
          currentValue: '2.78.4',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitlab-releases',
          registryUrls: ['https://gitlab.com'],
          currentValue: 'v1.2.3',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'FileSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitlab-tags',
          registryUrls: ['https://gitlab.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('classifies Codeberg, Gitea, and Bitbucket archive and git URLs', async () => {
      const sha = 'a'.repeat(64);
      const sha1 = 'b'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    ArchiveSource("https://codeberg.org/forgejo/forgejo/archive/v1.20.0.tar.gz", "${sha}"),`,
        `    ArchiveSource("https://gitea.com/foo/bar/archive/v2.0.tar.gz", "${sha}"),`,
        `    ArchiveSource("https://bitbucket.org/foo/bar/get/v3.1.tar.bz2", "${sha}"),`,
        `    GitSource("https://codeberg.org/forgejo/forgejo.git", "${sha1}"),`,
        `    GitSource("https://gitea.com/foo/bar.git", "${sha1}"),`,
        `    GitSource("https://bitbucket.org/foo/bar.git", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'forgejo/forgejo',
          packageName: 'forgejo/forgejo',
          datasource: 'forgejo-tags',
          registryUrls: ['https://codeberg.org'],
          currentValue: 'v1.20.0',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitea-tags',
          registryUrls: ['https://gitea.com'],
          currentValue: 'v2.0',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'bitbucket-tags',
          currentValue: 'v3.1',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'forgejo/forgejo',
          packageName: 'forgejo/forgejo',
          datasource: 'forgejo-tags',
          registryUrls: ['https://codeberg.org'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitea-tags',
          registryUrls: ['https://gitea.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'bitbucket-tags',
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('maps Azure DevOps SSH URLs (modern and legacy hosts) to azure-tags', async () => {
      const sha1 = 'e'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    GitSource("git@ssh.dev.azure.com:v3/contoso/widgets/widgetlib", "${sha1}"),`,
        `    GitSource("ssh://git@ssh.dev.azure.com/v3/contoso/widgets/widgetlib", "${sha1}"),`,
        `    GitSource("contoso@vs-ssh.visualstudio.com:v3/contoso/widgets/widgetlib", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://dev.azure.com/contoso'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://dev.azure.com/contoso'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://contoso.visualstudio.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('normalises SSH git URLs to https and re-classifies', async () => {
      const sha1 = 'd'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    GitSource("git@github.com:openssl/openssl.git", "${sha1}"),`,
        `    GitSource("ssh://git@gitlab.com/foo/bar.git", "${sha1}"),`,
        `    GitSource("git@codeberg.org:forgejo/forgejo", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'openssl/openssl',
          packageName: 'openssl/openssl',
          datasource: 'github-tags',
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitlab-tags',
          registryUrls: ['https://gitlab.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'forgejo/forgejo',
          packageName: 'forgejo/forgejo',
          datasource: 'forgejo-tags',
          registryUrls: ['https://codeberg.org'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('classifies modern and legacy Azure DevOps Repos URLs', async () => {
      const sha1 = 'c'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    GitSource("https://dev.azure.com/contoso/widgets/_git/widgetlib", "${sha1}"),`,
        `    GitSource("https://dev.azure.com/contoso/widgets/_git/widgetlib.git", "${sha1}"),`,
        `    GitSource("https://contoso.visualstudio.com/widgets/_git/widgetlib", "${sha1}"),`,
        `    GitSource("https://contoso.visualstudio.com/widgets/_git/widgetlib.git", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://dev.azure.com/contoso'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://dev.azure.com/contoso'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://contoso.visualstudio.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'widgets/widgetlib',
          packageName: 'widgets/widgetlib',
          datasource: 'azure-tags',
          registryUrls: ['https://contoso.visualstudio.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('auto-detects self-hosted Gitea and Forgejo via hostname convention', async () => {
      const sha = 'a'.repeat(64);
      const sha1 = 'b'.repeat(40);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    ArchiveSource("https://gitea.example.com/foo/bar/archive/v1.0.tar.gz", "${sha}"),`,
        `    ArchiveSource("https://forgejo.example.com/foo/bar/archive/v1.0.tar.gz", "${sha}"),`,
        `    GitSource("https://gitea.example.com/foo/bar.git", "${sha1}"),`,
        `    GitSource("https://forgejo.example.com/foo/bar.git", "${sha1}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitea-tags',
          registryUrls: ['https://gitea.example.com'],
          currentValue: 'v1.0',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'forgejo-tags',
          registryUrls: ['https://forgejo.example.com'],
          currentValue: 'v1.0',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'ArchiveSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'gitea-tags',
          registryUrls: ['https://gitea.example.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
        {
          depName: 'foo/bar',
          packageName: 'foo/bar',
          datasource: 'forgejo-tags',
          registryUrls: ['https://forgejo.example.com'],
          currentDigest: sha1,
          skipReason: 'unsupported-version',
          managerData: { hash: sha1, sourceType: 'GitSource' },
        },
      ]);
    });

    it('falls back to git-tags for any other `.git` URL', async () => {
      const url = 'https://git.savannah.gnu.org/git/coreutils.git';
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    GitSource("${url}",`,
        '              "d6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9"),',
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: url,
          packageName: url,
          datasource: 'git-tags',
          currentDigest: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
          skipReason: 'unsupported-version',
          managerData: {
            hash: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
            sourceType: 'GitSource',
          },
        },
      ]);
    });

    it('emits unsupported-url for GitSource URLs without a `.git` suffix', async () => {
      const content = [
        'using BinaryBuilder',
        'sources = [',
        '    GitSource("https://example.com/some/repo",',
        '              "d6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9"),',
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'https://example.com/some/repo',
          currentDigest: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
          skipReason: 'unsupported-url',
          managerData: {
            hash: 'd6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9',
            sourceType: 'GitSource',
          },
        },
      ]);
    });

    it('accepts SHA1, SHA384, and SHA512 hash lengths for archives', async () => {
      const sha512 = 'a'.repeat(128);
      const content = [
        'using BinaryBuilder',
        '',
        'name = "Foo"',
        'version = v"1.2.3"',
        '',
        'sources = [',
        `    ArchiveSource("https://github.com/foo/bar/releases/download/v1.2.3/bar.tar.gz", "${sha512}"),`,
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res).toEqual({
        packageFileVersion: '1.2.3',
        deps: [
          {
            depName: 'foo/bar',
            packageName: 'foo/bar',
            datasource: 'github-releases',
            currentValue: 'v1.2.3',
            currentDigest: sha512,
            skipReason: 'unsupported-version',
            managerData: {
              hash: sha512,
              sourceType: 'ArchiveSource',
            },
          },
        ],
      });
    });

    it('rejects wrong-length hashes on archive sources', async () => {
      const content = [
        'using BinaryBuilder',
        'sources = [',
        '    ArchiveSource("https://example.com/x.tar.gz", "deadbeef"),',
        ']',
      ].join('\n');
      expect(await extractPackageFile(content)).toBeNull();
    });

    it('rejects non-40-char hashes on git sources', async () => {
      const sha256 = 'b'.repeat(64);
      const content = [
        'using BinaryBuilder',
        'sources = [',
        `    GitSource("https://github.com/foo/bar.git", "${sha256}"),`,
        ']',
      ].join('\n');
      expect(await extractPackageFile(content)).toBeNull();
    });

    it('skips include resolution when no packageFile path is known', async () => {
      // Without a packageFile path, the AST walker cannot resolve the
      // include() target; the recipe falls back to whatever the regex
      // could pull out (here, nothing — there are no literal
      // ArchiveSource calls).
      const content = [
        'using BinaryBuilder',
        'include("../common.jl")',
        'sources = [',
        '    ArchiveSource("https://x/$(version).tar.gz", "abc"),',
        ']',
      ].join('\n');
      expect(await extractPackageFile(content)).toBeNull();
    });

    it('returns null when include() target is missing on disk', async () => {
      fs.readLocalFile.mockResolvedValueOnce(null);
      const content = [
        'using BinaryBuilder',
        'include("../missing.jl")',
        'sources = [',
        '    ArchiveSource("https://x/$(v).tar.gz", "abc"),',
        ']',
      ].join('\n');
      expect(
        await extractPackageFile(content, 'M/Missing/build_tarballs.jl'),
      ).toBeNull();
    });

    it('logs and skips when readLocalFile throws for an include() target', async () => {
      fs.readLocalFile.mockRejectedValueOnce(
        new Error('FILE_ACCESS_VIOLATION'),
      );
      const content = [
        'using BinaryBuilder',
        'include("../../../escape.jl")',
        'sources = [',
        '    ArchiveSource("https://x/$(v).tar.gz", "abc"),',
        ']',
      ].join('\n');
      expect(
        await extractPackageFile(content, 'B/Bad/build_tarballs.jl'),
      ).toBeNull();
    });

    it('walks bare expression statements inside an included file', async () => {
      const sha = '0'.repeat(40);
      // The included file contains both an assignment and a bare
      // expression statement that itself is a source-ctor call.
      const common = [
        'using BinaryBuilder',
        `GitSource("https://github.com/owner/repo.git", "${sha}")`,
      ].join('\n');
      fs.readLocalFile.mockResolvedValueOnce(common);
      const content = ['include("../common.jl")', 'sources = []'].join('\n');
      const res = await extractPackageFile(
        content,
        'X/Extras/build_tarballs.jl',
      );
      expect(res?.deps).toEqual([
        {
          depName: 'owner/repo',
          packageName: 'owner/repo',
          datasource: 'github-tags',
          currentDigest: sha,
          skipReason: 'unsupported-version',
          managerData: { hash: sha, sourceType: 'GitSource' },
        },
      ]);
    });

    it('resolves an indirect recipe via include() + versions dict lookup', async () => {
      // The recipe body refers to bindings defined in ../common.jl;
      // the AST walker resolves them and reconstructs the source URL
      // and hash.
      const sha = 'c'.repeat(64);
      const common = [
        'const versions = Dict(',
        `    "1.83.0" => (source_hash = "${sha}",),`,
        ')',
      ].join('\n');
      fs.readLocalFile.mockResolvedValueOnce(common);

      const content = [
        'using BinaryBuilder',
        'include("../common.jl")',
        'name = "Boost"',
        'version = v"1.83.0"',
        'underscore_version = replace(string(version), "." => "_")',
        'sources = [',
        '    ArchiveSource(',
        '        "https://archives.boost.io/release/$(version)/source/boost_$(underscore_version).tar.bz2",',
        '        versions[string(version)].source_hash,',
        '    ),',
        ']',
      ].join('\n');
      const res = await extractPackageFile(
        content,
        'B/Boost@1.83.0/build_tarballs.jl',
      );
      expect(res).toEqual({
        packageFileVersion: '1.83.0',
        deps: [
          {
            depName:
              'https://archives.boost.io/release/1.83.0/source/boost_1_83_0.tar.bz2',
            currentDigest: sha,
            skipReason: 'unsupported-url',
            managerData: {
              hash: sha,
              sourceType: 'ArchiveSource',
            },
          },
        ],
      });
    });

    it('omits packageFileVersion when no version literal is present', async () => {
      const content = [
        'using BinaryBuilder',
        'sources = [',
        '    GitSource("https://github.com/foo/bar.git",',
        '              "d6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9"),',
        ']',
      ].join('\n');
      const res = await extractPackageFile(content);
      expect(res).not.toBeNull();
      expect(res).not.toHaveProperty('packageFileVersion');
    });
  });
});
