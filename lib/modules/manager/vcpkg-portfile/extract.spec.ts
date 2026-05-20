import { Fixtures } from '~test/fixtures.ts';
import { extractPackageFile } from './extract.ts';

const portfile = Fixtures.get('portfile.cmake');

describe('modules/manager/vcpkg-portfile/extract', () => {
  describe('extractPackageFile()', () => {
    it('returns null when no vcpkg_from_* macro is present', () => {
      expect(
        extractPackageFile(
          'project(foo)\nmessage(STATUS "hello")\n',
          'ports/foo/portfile.cmake',
        ),
      ).toBeNull();
    });

    it('extracts every vcpkg_from_* variant from a sample portfile', () => {
      const res = extractPackageFile(portfile, 'ports/sample/portfile.cmake');
      expect(res).toEqual({
        deps: [
          {
            depName: 'openssl/openssl',
            packageName: 'openssl/openssl',
            currentValue: 'openssl-3.2.0',
            currentDigest:
              '14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e',
            datasource: 'github-tags',
            skipReason: 'unsupported',
          },
          {
            depName: 'libeigen/eigen',
            packageName: 'libeigen/eigen',
            currentValue: '3.4.0',
            currentDigest:
              'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            datasource: 'gitlab-tags',
            registryUrls: ['https://gitlab.com'],
            skipReason: 'unsupported',
          },
          {
            depName: 'example/lib',
            packageName: 'example/lib',
            currentValue: 'v1.2.3',
            currentDigest:
              '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            datasource: 'bitbucket-tags',
            skipReason: 'unsupported',
          },
          {
            depName: 'https://example.org/git/widget.git',
            packageName: 'https://example.org/git/widget.git',
            currentValue: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
            currentDigest: undefined,
            datasource: 'git-refs',
            skipReason: 'unsupported',
          },
          {
            depName: 'project/legacy',
            currentValue: '1.0',
            currentDigest:
              'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
            skipReason: 'unsupported-url',
          },
        ],
      });
    });

    it('extracts a gitlab call without GITLAB_URL', () => {
      const content = `vcpkg_from_gitlab(
        OUT_SOURCE_PATH SOURCE_PATH
        REPO group/project
        REF v0.1.0
        SHA512 deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef
      )`;
      const res = extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'group/project',
          packageName: 'group/project',
          currentValue: 'v0.1.0',
          currentDigest:
            'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          datasource: 'gitlab-tags',
          skipReason: 'unsupported',
        },
      ]);
    });

    it('emits sourceforge dep with placeholder name when REPO is missing', () => {
      const content = `vcpkg_from_sourceforge(
        OUT_SOURCE_PATH SOURCE_PATH
        REF 1.0
      )`;
      const res = extractPackageFile(content);
      expect(res?.deps).toEqual([
        {
          depName: 'sourceforge',
          currentValue: '1.0',
          currentDigest: undefined,
          skipReason: 'unsupported-url',
        },
      ]);
    });

    it('skips github calls missing REPO', () => {
      const content = `vcpkg_from_github(
        OUT_SOURCE_PATH SOURCE_PATH
        REF v1.0
        SHA512 cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe
      )`;
      expect(extractPackageFile(content)).toBeNull();
    });

    it('skips gitlab calls missing REPO', () => {
      const content = `vcpkg_from_gitlab(
        OUT_SOURCE_PATH SOURCE_PATH
        GITLAB_URL https://gitlab.example.org
        REF v1.0
      )`;
      expect(extractPackageFile(content)).toBeNull();
    });

    it('skips bitbucket calls missing REPO', () => {
      const content = `vcpkg_from_bitbucket(
        OUT_SOURCE_PATH SOURCE_PATH
        REF v1.0
      )`;
      expect(extractPackageFile(content)).toBeNull();
    });

    it('skips vcpkg_from_git calls missing URL', () => {
      const content = `vcpkg_from_git(
        OUT_SOURCE_PATH SOURCE_PATH
        REF abc123
      )`;
      expect(extractPackageFile(content)).toBeNull();
    });

    it('skips calls that use CMake variable substitution for REF', () => {
      const content = `set(MY_REF v1.2.3)
        vcpkg_from_github(
          OUT_SOURCE_PATH SOURCE_PATH
          REPO foo/bar
          REF \${MY_REF}
          SHA512 1111111111111111111111111111111111111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        )`;
      expect(extractPackageFile(content)).toBeNull();
    });
  });
});
