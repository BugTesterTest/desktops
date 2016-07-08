import Database from './database'
import Owner from '../models/owner'
import GitHubRepository from '../models/github-repository'
import Repository from '../models/repository'
import {APIRepository} from '../lib/api'

// NB: We can't use async/await within Dexie transactions. This is because Dexie
// uses its own Promise implementation and TypeScript doesn't know about it. See
// https://github.com/dfahlander/Dexie.js/wiki/Typescript#async-and-await, but
// note that their proposed work around doesn't seem to, you know, work, as of
// TS 1.8.
//
// Instead of using async/await, use generator functions and `yield`.

/** The store for local repositories. */
export default class RepositoriesStore {
  private db: Database

  public constructor(db: Database) {
    this.db = db
  }

  /** Get all the local repositories. */
  public async getRepositories(): Promise<Repository[]> {
    const inflatedRepos: Repository[] = []
    const db = this.db
    const transaction = this.db.transaction('r', this.db.repositories, this.db.gitHubRepositories, this.db.owners, function*(){
      const repos = yield db.repositories.toArray()
      for (const repo of repos) {
        let inflatedRepo: Repository = null
        if (repo.gitHubRepositoryID) {
          const gitHubRepository = yield db.gitHubRepositories.get(repo.gitHubRepositoryID)
          const owner = yield db.owners.get(gitHubRepository.ownerID)
          const gitHubRepo = new GitHubRepository(gitHubRepository.name, new Owner(owner.login, owner.endpoint), gitHubRepository.private, gitHubRepository.fork, gitHubRepository.htmlURL)
          inflatedRepo = new Repository(repo.path, gitHubRepo, repo.id)
        } else {
          inflatedRepo = new Repository(repo.path, null, repo.id)
        }
        inflatedRepos.push(inflatedRepo)
      }
    })

    await transaction

    return inflatedRepos
  }

  /** Add a new local repository. */
  public async addRepository(repo: Repository): Promise<Repository> {
    const db = this.db
    let id: number = null
    const transaction = this.db.transaction('rw', this.db.repositories, this.db.gitHubRepositories, this.db.owners, function*() {
      let gitHubRepositoryID: number = null
      const gitHubRepository = repo.getGitHubRepository()
      if (gitHubRepository) {
        const login = gitHubRepository.getOwner().getLogin()
        const existingOwner = yield db.owners.where('login').equalsIgnoreCase(login).limit(1).first()
        let ownerID: number = null
        if (existingOwner) {
          ownerID = existingOwner.id
        } else {
          ownerID = yield db.owners.add({login, endpoint: gitHubRepository.getOwner().getEndpoint()})
        }

        gitHubRepositoryID = yield db.gitHubRepositories.add({
          name: gitHubRepository.getName(),
          ownerID,
          private: null,
          fork: null,
          htmlURL: null,
        })
      }

      id = yield db.repositories.add({
        path: repo.getPath(),
        gitHubRepositoryID
      })
    })

    await transaction

    return repo.repositoryWithID(id)
  }

  public async updateGitHubRepository(id: number, repo: APIRepository): Promise<void> {
    const db = this.db
    const transaction = this.db.transaction('rw', this.db.repositories, this.db.gitHubRepositories, function*() {
      const localRepo = yield db.repositories.get(id)
      const gitHubRepo = yield db.gitHubRepositories.get(localRepo.gitHubRepositoryID)
      const updates = {private: repo.private, fork: repo.fork, htmlURL: repo.htmlUrl}
      yield db.gitHubRepositories.update(gitHubRepo.id, updates)
    })

    await transaction
  }
}