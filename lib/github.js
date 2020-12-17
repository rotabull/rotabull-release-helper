const { Octokit } = require("@octokit/core");

module.exports = class Github {
  constructor(token) {
    this.client = new Octokit({ auth: token });
  }

  getPrSha(pr) {
    const href = pr.statuses_url.split("/");

    return href[href.length - 1];
  }

  async getPr(prNumber) {
    const pr = await this.client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: 'rotabull',
      repo: 'rotabull',
      pull_number: prNumber,
    });

    return pr;
  };

  async addPrStatus({ sha, state, description }) {
    const status = await this.client.request('POST /repos/{owner}/{repo}/statuses/{sha}', {
      owner: 'rotabull',
      repo: 'rotabull',
      sha,
      description,
      state,
    });

    return status;
  };
}
