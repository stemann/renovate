vcpkg_from_github(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO openssl/openssl
    REF openssl-3.2.0
    SHA512 14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e
    HEAD_REF master
)

vcpkg_from_gitlab(
    GITLAB_URL https://gitlab.com
    OUT_SOURCE_PATH SOURCE_PATH
    REPO libeigen/eigen
    REF "3.4.0"
    SHA512 abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
    HEAD_REF master
)

vcpkg_from_bitbucket(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO example/lib
    REF v1.2.3
    SHA512 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    HEAD_REF main
)

vcpkg_from_git(
    OUT_SOURCE_PATH SOURCE_PATH
    URL https://example.org/git/widget.git
    REF 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b
)

vcpkg_from_sourceforge(
    OUT_SOURCE_PATH SOURCE_PATH
    REPO project/legacy
    REF 1.0
    FILENAME legacy-1.0.tar.gz
    SHA512 fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
)
