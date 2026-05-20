import type { Category } from '../../../constants/index.ts';
import { BitbucketTagsDatasource } from '../../datasource/bitbucket-tags/index.ts';
import { GitRefsDatasource } from '../../datasource/git-refs/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';
import { GitlabTagsDatasource } from '../../datasource/gitlab-tags/index.ts';

export { extractPackageFile } from './extract.ts';

export const displayName = 'vcpkg portfile';
export const url =
  'https://learn.microsoft.com/vcpkg/maintainers/maintainer-guide';
export const categories: Category[] = ['c'];

export const defaultConfig = {
  managerFilePatterns: ['/(^|/)ports/[^/]+/portfile\\.cmake$/'],
};

export const supportedDatasources = [
  BitbucketTagsDatasource.id,
  GitRefsDatasource.id,
  GithubTagsDatasource.id,
  GitlabTagsDatasource.id,
];
