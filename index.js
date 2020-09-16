const core = require("@actions/core");
//const github = require("@actions/github");
const axios = require("axios").default;
const moment = require("moment");

const REPO = "rotabull";
const OWNER = "rotabull";
const CLUBHOUSE_BASE_URL = "https://app.clubhouse.io/rotabull/story/";
const HEROKU_API_BASE_URL = "https://api.heroku.com";
const GITHUB_API_BASE_URL = "https://api.github.com";
const newLine = "\r\n";
const RETRIES = 5;
const TIME_OUT = 10000;

async function run() {
  let actionType = core.getInput("action-type");

  try {
    if (actionType === "release") {
      githubRelease();
    } else if (actionType === "promote") {
      promoteOnHeroku().then((id) => {
        console.log("Promotion ID is set to " + id);
        checkPromotionStatus(id, RETRIES, TIME_OUT);
      });
    }
    /// end of catch
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

function promoteOnHeroku() {
  const PIPELINE_ID = core.getInput("pipeline-id");
  const SOURCE_APP_ID = core.getInput("source-app-id");
  const TARGET_APP_ID = core.getInput("target-app-id");
  const HEROKU_API_KEY = core.getInput("heroku-api-key");
  var pipelinePromotionID = "initial";
  const herokuPromoteURL = `${HEROKU_API_BASE_URL}/pipeline-promotions`;
  const options = {
    headers: {
      Accept: "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json",
      Authorization: `Bearer ${HEROKU_API_KEY}`,
    },
  };
  const data = {
    pipeline: {
      id: PIPELINE_ID,
    },
    source: {
      app: {
        id: SOURCE_APP_ID,
      },
    },
    targets: [
      {
        app: {
          id: TARGET_APP_ID,
        },
      },
    ],
  };

  //create pipeline promotion and retrieve the pipeline promotion ID
  return axios
    .post(herokuPromoteURL, data, options)
    .then((response) => {
      console.log("Promote to pipeline response: ");
      console.log(response.data);
      pipelinePromotionID = response.data.id;
      console.log(
        "Pipeline promotion is created. Pipeline Promotion ID:" +
          pipelinePromotionID
      );
      return pipelinePromotionID;
    })
    .catch((error) => {
      console.log(error);
    });
}

function checkPromotionStatus(pipelinePromotionID, retries, timeout) {
  const HEROKU_API_KEY = core.getInput("heroku-api-key");

  const checkPromotionStatusURL = `${HEROKU_API_BASE_URL}/pipeline-promotions/${pipelinePromotionID}`;
  const options = {
    headers: {
      Accept: "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json",
      Authorization: `Bearer ${HEROKU_API_KEY}`,
    },
  };
  axios
    .get(checkPromotionStatusURL, options)
    .then((response) => {
      console.log("checking promotion status " + retries + ":");
      console.log(response.data);
      const status = response.data.status;
      if (
        status === "succeeded" ||
        status === "completed" ||
        status === "failed"
      ) {
        core.setOutput("promote-status", status);
      } else {
        if (retries > 0) {
          setTimeout(() => {
            return checkPromotionStatus(
              pipelinePromotionID,
              retries - 1,
              timeout
            );
          }, timeout);
        } else {
          core.setOutput("promote-status", "RETRY MAXIMUM REACHED");
        }
      }
    })
    .catch((error) => {
      console.log(error);
    });
}
function githubRelease() {
  const githubToken = core.getInput("github-token");

  const options = {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      Authorization: `token ${githubToken}`,
    },
  };

  // get last release tag to determine the next release tag
  const getLatestReleaseUrl = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/releases/latest`;
  var lastReleaseClubhouseNumbers = [];
  axios
    .get(getLatestReleaseUrl, options)
    .then((response) => {
      console.log("Release Latest Response:" + JSON.stringify(response.data));
      const nextReleaseTag = getNextReleaseTag(response.data.tag_name);

      lastReleaseClubhouseNumbers = extractAllClubhouseNumbersFromLastRelease(
        response.data.body
      );

      core.setOutput("release-tag", nextReleaseTag);
      core.setOutput("release-title", `Release ${nextReleaseTag}`);
    })
    .catch((error) => {
      console.log(error);
    });

  // Collect PRs (clubhouse story ID) being merged from last release based off last release summary
  // sort based on merged timestamp
  // If we can't find the PR based off the title, it is part of our next new release
  // If we found one matching any one of the previous clubhouse stories we have matched, then break the loop
  // If one latest has been released, then all the ones older than that one must already been released
  var collection = {
    Feature: [],
    Bugfix: [],
    Chore: [],
  };
  const getClosedPRsURL = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/pulls?state=closed`;
  axios
    .get(getClosedPRsURL, options)
    .then((response) => {
      console.log("Closed PRs:");
      var data = response.data;
      data.sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at));

      for (var i = 0, n = data.length; i < n; ++i) {
        if (data[i].merged_at === null) continue;
        const PRClubhouseNumber = extractClubhouseStoryNumber(
          data[i].title,
          data[i].body
        );
        console.log(
          "Clubhouse Numbers included in the last Release: " +
            lastReleaseClubhouseNumbers
        );
        if (lastReleaseClubhouseNumbers.includes(PRClubhouseNumber)) {
          break;
        }

        const branchName = data[i].head.ref;
        const category = extractCategory(branchName);
        const title = extractTitleIgnoringClubhouseNumber(data[i].title);

        collection = saveToCollection(
          collection,
          category,
          title,
          PRClubhouseNumber
        );
      }

      const releaseBody = composeReleaseBody(collection);
      console.log("Release body will be: " + releaseBody);
      core.setOutput("release-body", releaseBody);
    })
    .catch((error) => {
      console.log(error);
    });
}

function composeReleaseBody(collection) {
  const labels = {
    Feature: "### Features -- ⭐️",
    Bugfix: "### Bugfixes -- 🐞",
    Chore: "### Chores -- ⚙",
  };
  const header = "## What's Changed" + newLine;

  var notes = "";
  var totalPRCount = 0;
  for (const [category, titlesCollection] of Object.entries(collection)) {
    totalPRCount += titlesCollection.length;
    if (titlesCollection.length > 0) {
      notes = newLine + labels[category] + newLine;
      titlesCollection.forEach((element) => {
        notes += newLine + "* " + element + newLine;
      });
    }
  }

  if (totalPRCount > 0) return header + notes;
  return notes;
}

function saveToCollection(collection, category, title, PRClubhouseNumber) {
  console.log("category is:" + category);
  const content = `${title} [ch${PRClubhouseNumber}](${CLUBHOUSE_BASE_URL}${PRClubhouseNumber})`;
  const titles = collection[category];
  titles[titles.length] = content;
  return collection;
}

function extractClubhouseStoryNumber(title, body) {
  let clubhouseNumber = extractClubhouseNumberFromPRTitle(title);
  if (clubhouseNumber === null) {
    clubhouseNumber = extractClubhouseNumberFromPRBody(body);
  }
  return clubhouseNumber;
}

function extractClubhouseNumberFromPRBody(body) {
  var rx = /https:\/\/app\.clubhouse\.io\/rotabull\/story\/[0-9][0-9][0-9][0-9]/g;
  var arr = body.match(rx);
  if (arr === null) return null;
  const data = arr[0].split("/");
  return data[data.length - 1];
}

function extractClubhouseNumberFromPRTitle(title) {
  var rx = /\[ch[0-9][0-9][0-9][0-9]\]/g;
  var arr = title.match(rx);
  if (arr === null) return null;

  var rx2 = /[0-9][0-9][0-9][0-9]/g;
  return arr[0].match(rx2)[0];
}

function extractCategory(branchName) {
  console.log("branch name is : " + branchName);
  const prefix = branchName.split("/")[0].toLowerCase();

  if (prefix === "bug" || prefix === "bugfix") {
    return "Bugfix";
  }
  if (prefix === "enhancement" || prefix === "feature") {
    return "Feature";
  }
  return "Chore";
}

function extractAllClubhouseNumbersFromLastRelease(body) {
  var rx = /\[ch[0-9][0-9][0-9][0-9]\]/g;
  var rx2 = /[0-9][0-9][0-9][0-9]/g;
  var arr = body.match(rx);
  if (arr === null) return null;
  const newArray = arr.map((element) => element.match(rx2)[0]);
  return newArray;
}

function extractTitleIgnoringClubhouseNumber(title) {
  const rx = /\[ch[0-9][0-9][0-9][0-9]\]/g;
  const replaceWith = "";
  const after = title.replace(rx, replaceWith);
  return after.trim();
}
function getNextReleaseTag(lastReleaseTag) {
  console.log("Last release tag is " + lastReleaseTag);

  const date = moment().format("YYYY.MM.DD");
  if (lastReleaseTag === `v${date}`) {
    return `${lastReleaseTag}.1`;
  } else if (lastReleaseTag.includes(date)) {
    const splitted = lastReleaseTag.split(".");
    const newVersionNum = parseInt(splitted[splitted.length - 1]) + 1;
    return `v${date}.${newVersionNum}`;
  } else {
    return `v${date}`;
  }
}
// =======================
function getReleaseResponse() {
  const res = {
    data: {
      url: "https://api.github.com/repos/rotabull/rotabull/releases/31055927",
      assets_url:
        "https://api.github.com/repos/rotabull/rotabull/releases/31055927/assets",
      upload_url:
        "https://uploads.github.com/repos/rotabull/rotabull/releases/31055927/assets{?name,label}",
      html_url: "https://github.com/rotabull/rotabull/releases/tag/v1.107.2",
      id: 31055927,
      node_id: "MDc6UmVsZWFzZTMxMDU1OTI3",
      tag_name: "v1.107.2",
      target_commitish: "master",
      name: "Release 2020-09-10 (v1.107.2)",
      draft: false,
      author: {
        login: "github-actions[bot]",
        id: 41898282,
        node_id: "MDM6Qm90NDE4OTgyODI=",
        avatar_url: "https://avatars2.githubusercontent.com/in/15368?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/github-actions%5Bbot%5D",
        html_url: "https://github.com/apps/github-actions",
        followers_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/followers",
        following_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/following{/other_user}",
        gists_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/subscriptions",
        organizations_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/orgs",
        repos_url: "https://api.github.com/users/github-actions%5Bbot%5D/repos",
        events_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/github-actions%5Bbot%5D/received_events",
        type: "Bot",
        site_admin: false,
      },
      prerelease: false,
      created_at: "2020-09-10T17:52:49Z",
      published_at: "2020-09-10T21:28:52Z",
      assets: [],
      tarball_url:
        "https://api.github.com/repos/rotabull/rotabull/tarball/v1.107.2",
      zipball_url:
        "https://api.github.com/repos/rotabull/rotabull/zipball/v1.107.2",
      body:
        "## What's Changed\r\n" +
        "\r\n" +
        "###  Features -- ⭐️\r\n" +
        "\r\n" +
        "* Financial MMVP [ch3023](https://app.clubhouse.io/rotabull/story/3023)\r\n" +
        "* [ch3332](https://app.clubhouse.io/rotabull/story/3332) September UI clean up\r\n" +
        "\r\n" +
        "### Bugfixes -- 🐞\r\n" +
        "\r\n" +
        "* Change Quickbooks invoice worker to run every 10 minutes [ch3644](https://app.clubhouse.io/rotabull/story/3644)\r\n" +
        "* Clean up notification emails [ch3331](https://app.clubhouse.io/rotabull/story/3331)\r\n" +
        "* [ch3615](https://app.clubhouse.io/rotabull/story/3615) Fix date selection in reports and correcly round prices sent to Eplane\r\n" +
        "\r\n" +
        "### Chores -- ⚙️\r\n" +
        "\r\n" +
        "* add some extra logging for locatory [ch3412]",
    },
  };
  return res;
}

function getClosedPrResponseData() {
  const closedPrResponseData = [
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1230",
      id: 486092029,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDg2MDkyMDI5",
      html_url: "https://github.com/rotabull/rotabull/pull/1230",
      diff_url: "https://github.com/rotabull/rotabull/pull/1230.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1230.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1230",
      number: 1230,
      state: "closed",
      locked: false,
      title: "Demo/context 2",
      user: {
        login: "Kysss",
        id: 11917486,
        node_id: "MDQ6VXNlcjExOTE3NDg2",
        avatar_url: "https://avatars1.githubusercontent.com/u/11917486?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/Kysss",
        html_url: "https://github.com/Kysss",
        followers_url: "https://api.github.com/users/Kysss/followers",
        following_url:
          "https://api.github.com/users/Kysss/following{/other_user}",
        gists_url: "https://api.github.com/users/Kysss/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/Kysss/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/Kysss/subscriptions",
        organizations_url: "https://api.github.com/users/Kysss/orgs",
        repos_url: "https://api.github.com/users/Kysss/repos",
        events_url: "https://api.github.com/users/Kysss/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/Kysss/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "_Please summarize your changes here._\r\n" +
        "\r\n" +
        "_The most helpful descriptions guide the reviewer through the code as much as possible, highlighting related files and grouping them into concepts or problems that are being solved. If need be, add additional comments to the commited files._\r\n" +
        "\r\n" +
        "_Everything above the horizontal ruler below will become the merge PR description._\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/STORY_ID)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [ ] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "- [ ] Equivalent test file created in parallel for any new code file(s)\r\n" +
        "- [ ] Test case duplication minimized (special care paid to e2e tests)\r\n" +
        "- [ ] <put additional here or remove>\r\n" +
        "\r\n" +
        "### SQL\r\n" +
        "\r\n" +
        "- [ ] `EXPLAIN ANALYZE` run against staging for potentially complex queries (include result as a comment)\r\n" +
        "\r\n" +
        "### Deployment\r\n" +
        "\r\n" +
        "- [ ] Special deployment instructions or dependencies are flagged (e.g. install chromedriver in prod environments)\r\n" +
        "- [ ] Data migrations (automatic or manual) are mentioned on the story\r\n" +
        "- [ ] Seed data (`lib/rotabull/seed.ex`) updated to account for migrations\r\n" +
        "- [ ] <put additional here or remove>\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [ ] Feature works with fake data on localhost\r\n" +
        "- [ ] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [ ] Feature performance is acceptable with staging data\r\n" +
        "- [ ] UI design works properly with staging data\r\n" +
        "- [ ] <put additional here or remove>\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [ ] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-13T02:07:18Z",
      updated_at: "2020-09-13T02:07:29Z",
      closed_at: "2020-09-13T02:07:29Z",
      merged_at: null,
      merge_commit_sha: null,
      assignee: null,
      assignees: [],
      requested_reviewers: [],
      requested_teams: [],
      labels: [],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1230/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1230/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1230/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/2e6380b1620aab79cc205acef27b2a300cf44845",
      head: {
        label: "rotabull:demo/context-2",
        ref: "demo/context-2",
        sha: "2e6380b1620aab79cc205acef27b2a300cf44845",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "3f65a0636f1574f70a732c74fc9b10c6c6750fde",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1229",
      id: 485488847,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDg1NDg4ODQ3",
      html_url: "https://github.com/rotabull/rotabull/pull/1229",
      diff_url: "https://github.com/rotabull/rotabull/pull/1229.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1229.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1229",
      number: 1229,
      state: "closed",
      locked: false,
      title:
        "[ch3681] Properly display/download attachments from an email quote",
      user: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        'Add the filename of the attachment in the "download" attribute so it can be properly displayed/download when clicking on it\r\n' +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3681)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-11T21:47:04Z",
      updated_at: "2020-09-11T23:37:26Z",
      closed_at: "2020-09-11T23:37:25Z",
      merged_at: "2020-09-11T23:37:25Z",
      merge_commit_sha: "3f65a0636f1574f70a732c74fc9b10c6c6750fde",
      assignee: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1229/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1229/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1229/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/2760d6b9d3f35d28d870cc700a8a5f0d0d6f0652",
      head: {
        label: "rotabull:bug/ch3681",
        ref: "bug/ch3681",
        sha: "2760d6b9d3f35d28d870cc700a8a5f0d0d6f0652",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "459b2c3a4f21e52d520ab1958620c047e3116a97",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1227",
      id: 484121305,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDg0MTIxMzA1",
      html_url: "https://github.com/rotabull/rotabull/pull/1227",
      diff_url: "https://github.com/rotabull/rotabull/pull/1227.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1227.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1227",
      number: 1227,
      state: "closed",
      locked: false,
      title:
        "Change Quickbooks invoice worker to run every 10 minutes [ch3644]",
      user: {
        login: "benjaminsfrank",
        id: 714472,
        node_id: "MDQ6VXNlcjcxNDQ3Mg==",
        avatar_url: "https://avatars0.githubusercontent.com/u/714472?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/benjaminsfrank",
        html_url: "https://github.com/benjaminsfrank",
        followers_url: "https://api.github.com/users/benjaminsfrank/followers",
        following_url:
          "https://api.github.com/users/benjaminsfrank/following{/other_user}",
        gists_url:
          "https://api.github.com/users/benjaminsfrank/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/benjaminsfrank/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/benjaminsfrank/subscriptions",
        organizations_url: "https://api.github.com/users/benjaminsfrank/orgs",
        repos_url: "https://api.github.com/users/benjaminsfrank/repos",
        events_url:
          "https://api.github.com/users/benjaminsfrank/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/benjaminsfrank/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "QBO Sync was mistakenly set to run once per day at 10am UTC. Instead, it should be run every 10 minutes.\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3644/quickbooks-sync-doesn-t-rrun-on-schedule)\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-10T17:18:23Z",
      updated_at: "2020-09-10T17:53:07Z",
      closed_at: "2020-09-10T17:52:50Z",
      merged_at: "2020-09-10T17:52:50Z",
      merge_commit_sha: "ea5966dcdca558098475a6e2e8aac30f22598d54",
      assignee: null,
      assignees: [],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1227/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1227/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1227/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/c51d60fd9919bfa4ff4a39d1bc3edda63fa6d321",
      head: {
        label: "rotabull:bugfix/qbo-sync-schedule",
        ref: "bugfix/qbo-sync-schedule",
        sha: "c51d60fd9919bfa4ff4a39d1bc3edda63fa6d321",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "8e4ecfad9fac8962158f855bba63c9ee08d44b7a",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1226",
      id: 484050961,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDg0MDUwOTYx",
      html_url: "https://github.com/rotabull/rotabull/pull/1226",
      diff_url: "https://github.com/rotabull/rotabull/pull/1226.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1226.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1226",
      number: 1226,
      state: "closed",
      locked: false,
      title: "Clean up notification emails [ch3331]",
      user: {
        login: "dnwz",
        id: 31702817,
        node_id: "MDQ6VXNlcjMxNzAyODE3",
        avatar_url: "https://avatars2.githubusercontent.com/u/31702817?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/dnwz",
        html_url: "https://github.com/dnwz",
        followers_url: "https://api.github.com/users/dnwz/followers",
        following_url:
          "https://api.github.com/users/dnwz/following{/other_user}",
        gists_url: "https://api.github.com/users/dnwz/gists{/gist_id}",
        starred_url: "https://api.github.com/users/dnwz/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/dnwz/subscriptions",
        organizations_url: "https://api.github.com/users/dnwz/orgs",
        repos_url: "https://api.github.com/users/dnwz/repos",
        events_url: "https://api.github.com/users/dnwz/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/dnwz/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Cleaned up notification emails by removing bold text and correcting plurals for assignment emails and fixing GIF placement. Added Rotabull logo `role` attribute and removed `alt` attribute to fix email preview text. Also set seed data users to not receive new RFQ notifications.\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3331)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "- [x] Equivalent test file created in parallel for any new code file(s)\r\n" +
        "- [x] Test case duplication minimized (special care paid to e2e tests)\r\n" +
        "\r\n" +
        "### SQL\r\n" +
        "\r\n" +
        "N/A\r\n" +
        "\r\n" +
        "### Deployment\r\n" +
        "\r\n" +
        "N/A\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "- [x] UI design works properly with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-10T16:07:43Z",
      updated_at: "2020-09-10T17:49:06Z",
      closed_at: "2020-09-10T17:49:05Z",
      merged_at: "2020-09-10T17:49:05Z",
      merge_commit_sha: "8e4ecfad9fac8962158f855bba63c9ee08d44b7a",
      assignee: {
        login: "dnwz",
        id: 31702817,
        node_id: "MDQ6VXNlcjMxNzAyODE3",
        avatar_url: "https://avatars2.githubusercontent.com/u/31702817?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/dnwz",
        html_url: "https://github.com/dnwz",
        followers_url: "https://api.github.com/users/dnwz/followers",
        following_url:
          "https://api.github.com/users/dnwz/following{/other_user}",
        gists_url: "https://api.github.com/users/dnwz/gists{/gist_id}",
        starred_url: "https://api.github.com/users/dnwz/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/dnwz/subscriptions",
        organizations_url: "https://api.github.com/users/dnwz/orgs",
        repos_url: "https://api.github.com/users/dnwz/repos",
        events_url: "https://api.github.com/users/dnwz/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/dnwz/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object]],
      requested_teams: [],
      labels: [[Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1226/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1226/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1226/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/0107fd61b1d6386863c7ba748505732c733fda1f",
      head: {
        label: "rotabull:feature/ch3331",
        ref: "feature/ch3331",
        sha: "0107fd61b1d6386863c7ba748505732c733fda1f",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "f79851a67da1f9c11c964645687836751e697cbb",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1225",
      id: 483085810,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgzMDg1ODEw",
      html_url: "https://github.com/rotabull/rotabull/pull/1225",
      diff_url: "https://github.com/rotabull/rotabull/pull/1225.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1225.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1225",
      number: 1225,
      state: "closed",
      locked: false,
      title:
        "[ch3615] Fix date selection in reports and correcly round prices sent to Eplane",
      user: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        '- Format each part "price" before sending listings to eplane (we use cents to store information on the db)\r\n' +
        '- Pass desired format when parsing dates in the record page. The error itself was being caused by not "supported" date formats but only webkit (or safari) seems to have trouble with that.\r\n' +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3615)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "- [x] Equivalent test file created in parallel for any new code file(s)\r\n" +
        "- [x] Test case duplication minimized (special care paid to e2e tests)\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "- [x] UI design works properly with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-09T19:33:35Z",
      updated_at: "2020-09-10T13:10:51Z",
      closed_at: "2020-09-10T13:10:50Z",
      merged_at: "2020-09-10T13:10:50Z",
      merge_commit_sha: "196c704db655099b1a5ac303404ef8d53fafb749",
      assignee: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1225/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1225/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1225/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/4f86418078ae849a4fb718f5ee970b16a7b2be60",
      head: {
        label: "rotabull:bug/ch3615",
        ref: "bug/ch3615",
        sha: "4f86418078ae849a4fb718f5ee970b16a7b2be60",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "e63e324ae60f2120c504d13fbbcfd9d43edaf4fa",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1224",
      id: 483072976,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgzMDcyOTc2",
      html_url: "https://github.com/rotabull/rotabull/pull/1224",
      diff_url: "https://github.com/rotabull/rotabull/pull/1224.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1224.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1224",
      number: 1224,
      state: "closed",
      locked: false,
      title: "Financial cleanup 1 [ch3633]",
      user: {
        login: "benjaminsfrank",
        id: 714472,
        node_id: "MDQ6VXNlcjcxNDQ3Mg==",
        avatar_url: "https://avatars0.githubusercontent.com/u/714472?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/benjaminsfrank",
        html_url: "https://github.com/benjaminsfrank",
        followers_url: "https://api.github.com/users/benjaminsfrank/followers",
        following_url:
          "https://api.github.com/users/benjaminsfrank/following{/other_user}",
        gists_url:
          "https://api.github.com/users/benjaminsfrank/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/benjaminsfrank/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/benjaminsfrank/subscriptions",
        organizations_url: "https://api.github.com/users/benjaminsfrank/orgs",
        repos_url: "https://api.github.com/users/benjaminsfrank/repos",
        events_url:
          "https://api.github.com/users/benjaminsfrank/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/benjaminsfrank/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Various Financial tweaks and fixes:\r\n" +
        "\r\n" +
        "- fix bug where rotabull couldn't debit account via plaid, because of missing plaid config\r\n" +
        "- fix bug that allowed `credit_available_cents` to go into the negative, because it was not just looking at loan principal\r\n" +
        "- fix bug where you could draw against an invoice, even if there was $0 credit available\r\n" +
        "- various small copy and UI improvements\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3633/financial-cleanup-1)\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-09T19:16:16Z",
      updated_at: "2020-09-09T20:27:26Z",
      closed_at: "2020-09-09T20:27:25Z",
      merged_at: "2020-09-09T20:27:25Z",
      merge_commit_sha: "e63e324ae60f2120c504d13fbbcfd9d43edaf4fa",
      assignee: null,
      assignees: [],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1224/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1224/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1224/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/bb9e8227e8eebfd3f145b7af1097cc841c819281",
      head: {
        label: "rotabull:chore/financial-fixes",
        ref: "chore/financial-fixes",
        sha: "bb9e8227e8eebfd3f145b7af1097cc841c819281",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "a28ad146ad903eb08c3a7d4ebbf8c55cdeaddd6d",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1222",
      id: 482865328,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgyODY1MzI4",
      html_url: "https://github.com/rotabull/rotabull/pull/1222",
      diff_url: "https://github.com/rotabull/rotabull/pull/1222.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1222.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1222",
      number: 1222,
      state: "closed",
      locked: false,
      title: "add some extra logging for locatory [ch3412]",
      user: {
        login: "rotabull-keith",
        id: 59477735,
        node_id: "MDQ6VXNlcjU5NDc3NzM1",
        avatar_url: "https://avatars3.githubusercontent.com/u/59477735?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/rotabull-keith",
        html_url: "https://github.com/rotabull-keith",
        followers_url: "https://api.github.com/users/rotabull-keith/followers",
        following_url:
          "https://api.github.com/users/rotabull-keith/following{/other_user}",
        gists_url:
          "https://api.github.com/users/rotabull-keith/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/rotabull-keith/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/rotabull-keith/subscriptions",
        organizations_url: "https://api.github.com/users/rotabull-keith/orgs",
        repos_url: "https://api.github.com/users/rotabull-keith/repos",
        events_url:
          "https://api.github.com/users/rotabull-keith/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/rotabull-keith/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "We have not seen this error in several days now and suspect either something wrong from locatory API results or a first time pull issue. There was far too little information to even try to test or investigate further as we didn't even know which organization was involved. This PR simply adds some more logging information. \r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3412)\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-09T13:58:34Z",
      updated_at: "2020-09-10T13:13:57Z",
      closed_at: "2020-09-10T13:13:56Z",
      merged_at: "2020-09-10T13:13:56Z",
      merge_commit_sha: "f79851a67da1f9c11c964645687836751e697cbb",
      assignee: {
        login: "rotabull-keith",
        id: 59477735,
        node_id: "MDQ6VXNlcjU5NDc3NzM1",
        avatar_url: "https://avatars3.githubusercontent.com/u/59477735?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/rotabull-keith",
        html_url: "https://github.com/rotabull-keith",
        followers_url: "https://api.github.com/users/rotabull-keith/followers",
        following_url:
          "https://api.github.com/users/rotabull-keith/following{/other_user}",
        gists_url:
          "https://api.github.com/users/rotabull-keith/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/rotabull-keith/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/rotabull-keith/subscriptions",
        organizations_url: "https://api.github.com/users/rotabull-keith/orgs",
        repos_url: "https://api.github.com/users/rotabull-keith/repos",
        events_url:
          "https://api.github.com/users/rotabull-keith/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/rotabull-keith/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1222/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1222/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1222/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/9dd399031b642be5074db2a5e7f3c81ad05a0075",
      head: {
        label: "rotabull:bug/ch3421",
        ref: "bug/ch3421",
        sha: "9dd399031b642be5074db2a5e7f3c81ad05a0075",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "196c704db655099b1a5ac303404ef8d53fafb749",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1221",
      id: 482425768,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgyNDI1NzY4",
      html_url: "https://github.com/rotabull/rotabull/pull/1221",
      diff_url: "https://github.com/rotabull/rotabull/pull/1221.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1221.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1221",
      number: 1221,
      state: "closed",
      locked: false,
      title: "Bugfix/broken financial emails",
      user: {
        login: "benjaminsfrank",
        id: 714472,
        node_id: "MDQ6VXNlcjcxNDQ3Mg==",
        avatar_url: "https://avatars0.githubusercontent.com/u/714472?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/benjaminsfrank",
        html_url: "https://github.com/benjaminsfrank",
        followers_url: "https://api.github.com/users/benjaminsfrank/followers",
        following_url:
          "https://api.github.com/users/benjaminsfrank/following{/other_user}",
        gists_url:
          "https://api.github.com/users/benjaminsfrank/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/benjaminsfrank/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/benjaminsfrank/subscriptions",
        organizations_url: "https://api.github.com/users/benjaminsfrank/orgs",
        repos_url: "https://api.github.com/users/benjaminsfrank/repos",
        events_url:
          "https://api.github.com/users/benjaminsfrank/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/benjaminsfrank/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Another bug related to setup state, resulting from column renamings.",
      created_at: "2020-09-09T02:09:51Z",
      updated_at: "2020-09-09T02:12:58Z",
      closed_at: "2020-09-09T02:10:51Z",
      merged_at: "2020-09-09T02:10:51Z",
      merge_commit_sha: "8c0dfb687072867b85a66a6700c20b56eae84649",
      assignee: null,
      assignees: [],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1221/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1221/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1221/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/306b4eb9528108b582a4b2bf6f54a8eac0ec5a38",
      head: {
        label: "rotabull:bugfix/broken-financial-emails",
        ref: "bugfix/broken-financial-emails",
        sha: "306b4eb9528108b582a4b2bf6f54a8eac0ec5a38",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "52f59beca9018697b035ea810f140c02b0cef25a",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1220",
      id: 482396484,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgyMzk2NDg0",
      html_url: "https://github.com/rotabull/rotabull/pull/1220",
      diff_url: "https://github.com/rotabull/rotabull/pull/1220.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1220.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1220",
      number: 1220,
      state: "closed",
      locked: false,
      title: "add leading https:// to quickbooks redirect urls [ch3598]",
      user: {
        login: "benjaminsfrank",
        id: 714472,
        node_id: "MDQ6VXNlcjcxNDQ3Mg==",
        avatar_url: "https://avatars0.githubusercontent.com/u/714472?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/benjaminsfrank",
        html_url: "https://github.com/benjaminsfrank",
        followers_url: "https://api.github.com/users/benjaminsfrank/followers",
        following_url:
          "https://api.github.com/users/benjaminsfrank/following{/other_user}",
        gists_url:
          "https://api.github.com/users/benjaminsfrank/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/benjaminsfrank/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/benjaminsfrank/subscriptions",
        organizations_url: "https://api.github.com/users/benjaminsfrank/orgs",
        repos_url: "https://api.github.com/users/benjaminsfrank/repos",
        events_url:
          "https://api.github.com/users/benjaminsfrank/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/benjaminsfrank/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Bugfix where the redirect_uri for quickbooks was being set as `staging.rotabull.com instead of `https://staging.rotabull.com`. It needed to be fully specified.\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3598/redirect-uri-is-not-fully-qualified-breaking-quickbooks-oauth)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "N/A\r\n" +
        "\r\n" +
        "### SQL\r\n" +
        "\r\n" +
        "\r\n" +
        "\r\n" +
        "### Deployment\r\n" +
        "\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "\r\n",
      created_at: "2020-09-09T01:16:26Z",
      updated_at: "2020-09-09T01:18:11Z",
      closed_at: "2020-09-09T01:18:10Z",
      merged_at: "2020-09-09T01:18:10Z",
      merge_commit_sha: "52f59beca9018697b035ea810f140c02b0cef25a",
      assignee: null,
      assignees: [],
      requested_reviewers: [[Object]],
      requested_teams: [],
      labels: [[Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1220/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1220/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1220/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/33abd96984563c3e2ab76af685da6aaa45ef25b9",
      head: {
        label: "rotabull:bugfix/qbo-redirect-uri",
        ref: "bugfix/qbo-redirect-uri",
        sha: "33abd96984563c3e2ab76af685da6aaa45ef25b9",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "a1ffe17e8e518706b207d856f805a74c510fb9b2",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "CONTRIBUTOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1219",
      id: 482117628,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgyMTE3NjI4",
      html_url: "https://github.com/rotabull/rotabull/pull/1219",
      diff_url: "https://github.com/rotabull/rotabull/pull/1219.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1219.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1219",
      number: 1219,
      state: "closed",
      locked: false,
      title: "[ch3437] Display message for Stripe's payment failure",
      user: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        `Display to the user stripe's message if they payment failed due to a "rejection" from the given credit card to perform the payment.\r\n` +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3437)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "- [x] Test case duplication minimized (special care paid to e2e tests)\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-08T15:13:52Z",
      updated_at: "2020-09-09T13:39:20Z",
      closed_at: "2020-09-09T13:39:19Z",
      merged_at: "2020-09-09T13:39:19Z",
      merge_commit_sha: "a28ad146ad903eb08c3a7d4ebbf8c55cdeaddd6d",
      assignee: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1219/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1219/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1219/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/7dc79cb2c38d7bf54370b27bffe4207a8655d66a",
      head: {
        label: "rotabull:bugfix/ch3437/display-reason-for-payment-failure",
        ref: "bugfix/ch3437/display-reason-for-payment-failure",
        sha: "7dc79cb2c38d7bf54370b27bffe4207a8655d66a",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "8c0dfb687072867b85a66a6700c20b56eae84649",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1218",
      id: 482112340,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgyMTEyMzQw",
      html_url: "https://github.com/rotabull/rotabull/pull/1218",
      diff_url: "https://github.com/rotabull/rotabull/pull/1218.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1218.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1218",
      number: 1218,
      state: "closed",
      locked: false,
      title: "Oban queue/tags and dasboard [ch3294]",
      user: {
        login: "rotabull-keith",
        id: 59477735,
        node_id: "MDQ6VXNlcjU5NDc3NzM1",
        avatar_url: "https://avatars3.githubusercontent.com/u/59477735?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/rotabull-keith",
        html_url: "https://github.com/rotabull-keith",
        followers_url: "https://api.github.com/users/rotabull-keith/followers",
        following_url:
          "https://api.github.com/users/rotabull-keith/following{/other_user}",
        gists_url:
          "https://api.github.com/users/rotabull-keith/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/rotabull-keith/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/rotabull-keith/subscriptions",
        organizations_url: "https://api.github.com/users/rotabull-keith/orgs",
        repos_url: "https://api.github.com/users/rotabull-keith/repos",
        events_url:
          "https://api.github.com/users/rotabull-keith/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/rotabull-keith/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Every job now is set into a specific queue with some tags attached to improve search-ability. Also added the oban pro dashboard under admin as it provides much more than the initial view we put together. \r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3294)\r\n" +
        "\r\n" +
        "### Deployment\r\n" +
        "\r\n" +
        "- [x] required for everyone to add mix hex.organization auth oban --key 47a9e081b0e7feb53188c3d26aaac753\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-08T15:05:54Z",
      updated_at: "2020-09-11T13:19:59Z",
      closed_at: "2020-09-11T13:19:58Z",
      merged_at: "2020-09-11T13:19:58Z",
      merge_commit_sha: "459b2c3a4f21e52d520ab1958620c047e3116a97",
      assignee: {
        login: "rotabull-keith",
        id: 59477735,
        node_id: "MDQ6VXNlcjU5NDc3NzM1",
        avatar_url: "https://avatars3.githubusercontent.com/u/59477735?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/rotabull-keith",
        html_url: "https://github.com/rotabull-keith",
        followers_url: "https://api.github.com/users/rotabull-keith/followers",
        following_url:
          "https://api.github.com/users/rotabull-keith/following{/other_user}",
        gists_url:
          "https://api.github.com/users/rotabull-keith/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/rotabull-keith/starred{/owner}{/repo}",
        subscriptions_url:
          "https://api.github.com/users/rotabull-keith/subscriptions",
        organizations_url: "https://api.github.com/users/rotabull-keith/orgs",
        repos_url: "https://api.github.com/users/rotabull-keith/repos",
        events_url:
          "https://api.github.com/users/rotabull-keith/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/rotabull-keith/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [],
      requested_teams: [],
      labels: [[Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1218/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1218/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1218/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/35c15ac1df61f6cf460ee465bb045f9023041014",
      head: {
        label: "rotabull:feature/ch3294",
        ref: "feature/ch3294",
        sha: "35c15ac1df61f6cf460ee465bb045f9023041014",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "ea5966dcdca558098475a6e2e8aac30f22598d54",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1217",
      id: 481627798,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgxNjI3Nzk4",
      html_url: "https://github.com/rotabull/rotabull/pull/1217",
      diff_url: "https://github.com/rotabull/rotabull/pull/1217.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1217.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1217",
      number: 1217,
      state: "closed",
      locked: false,
      title: "[ch3483] Smart Quote bug doesn't load properly on repair RFQs",
      user: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "Smart Quote was failing due to the fact that it was using _unique_ part numbers and in most (if not all) repair RFQs, the part number is repeated but only the service differs. In order to change solve this bug, the following was done:\r\n" +
        "- Abstract logic that takes the part number(s) with price type(s) or requested service(s) (depending of the type of the RFQ) into a function inside the `Deals` BLOM.\r\n" +
        "- Rename a variable so it explicitly says that it only contains _unique_ part numbers\r\n" +
        "- Add a regression test, which only was failing in the `get_deal_metadata` endpoint.\r\n" +
        "- Add a test for the new function\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3483)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "- [x] Equivalent test file created in parallel for any new code file(s)\r\n" +
        "- [x] Test case duplication minimized (special care paid to e2e tests)\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "- [x] UI design works properly with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-07T20:21:25Z",
      updated_at: "2020-09-08T02:36:53Z",
      closed_at: "2020-09-08T02:36:52Z",
      merged_at: "2020-09-08T02:36:52Z",
      merge_commit_sha: "573de34b3ae5a56a9601df98869b2ab4972a2c8c",
      assignee: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1217/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1217/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1217/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/94430f5487e4e981313ea8aa9b5b376548f155c7",
      head: {
        label: "rotabull:bugfix/ch3483/sq-bug-on-repair-rfqs",
        ref: "bugfix/ch3483/sq-bug-on-repair-rfqs",
        sha: "94430f5487e4e981313ea8aa9b5b376548f155c7",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "40b199479558a590de9416492c7964716a571ceb",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
    {
      url: "https://api.github.com/repos/rotabull/rotabull/pulls/1216",
      id: 481507296,
      node_id: "MDExOlB1bGxSZXF1ZXN0NDgxNTA3Mjk2",
      html_url: "https://github.com/rotabull/rotabull/pull/1216",
      diff_url: "https://github.com/rotabull/rotabull/pull/1216.diff",
      patch_url: "https://github.com/rotabull/rotabull/pull/1216.patch",
      issue_url: "https://api.github.com/repos/rotabull/rotabull/issues/1216",
      number: 1216,
      state: "closed",
      locked: false,
      title: "[ch3332] September UI clean up",
      user: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      body:
        "- Don't show smart quote popover if the button is disabled.\r\n" +
        `- Adjust routing rules "drag" icon with grey color and vertically align it to the middle, also make "options" to don't inline when there are several "parameters" selected.\r\n` +
        '- Display routing rules by descendant order by their "precedence".\r\n' +
        "- Display line item notes properly in the email preview for Repair RFQs\r\n" +
        "\r\n" +
        "---\r\n" +
        "\r\n" +
        "## Clubhouse Link\r\n" +
        "\r\n" +
        "[Clubhouse Story](https://app.clubhouse.io/rotabull/story/3332)\r\n" +
        "\r\n" +
        "### Tests\r\n" +
        "\r\n" +
        "- [x] New functionality covered — even for the smallest changes, there should be a test that fails when the new code is removed\r\n" +
        "\r\n" +
        "### Manual testing\r\n" +
        "\r\n" +
        "- [x] Feature works with fake data on localhost\r\n" +
        "- [x] Feature tested against staging database (when possible: bin/phx_server_staging.sh)\r\n" +
        "- [x] Feature performance is acceptable with staging data\r\n" +
        "- [x] UI design works properly with staging data\r\n" +
        "\r\n" +
        "### Acceptance\r\n" +
        "\r\n" +
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n",
      created_at: "2020-09-07T15:57:06Z",
      updated_at: "2020-09-08T14:47:03Z",
      closed_at: "2020-09-08T14:47:02Z",
      merged_at: "2020-09-08T14:47:02Z",
      merge_commit_sha: "a1ffe17e8e518706b207d856f805a74c510fb9b2",
      assignee: {
        login: "ibarrae",
        id: 22796877,
        node_id: "MDQ6VXNlcjIyNzk2ODc3",
        avatar_url: "https://avatars0.githubusercontent.com/u/22796877?v=4",
        gravatar_id: "",
        url: "https://api.github.com/users/ibarrae",
        html_url: "https://github.com/ibarrae",
        followers_url: "https://api.github.com/users/ibarrae/followers",
        following_url:
          "https://api.github.com/users/ibarrae/following{/other_user}",
        gists_url: "https://api.github.com/users/ibarrae/gists{/gist_id}",
        starred_url:
          "https://api.github.com/users/ibarrae/starred{/owner}{/repo}",
        subscriptions_url: "https://api.github.com/users/ibarrae/subscriptions",
        organizations_url: "https://api.github.com/users/ibarrae/orgs",
        repos_url: "https://api.github.com/users/ibarrae/repos",
        events_url: "https://api.github.com/users/ibarrae/events{/privacy}",
        received_events_url:
          "https://api.github.com/users/ibarrae/received_events",
        type: "User",
        site_admin: false,
      },
      assignees: [[Object]],
      requested_reviewers: [[Object], [Object]],
      requested_teams: [],
      labels: [[Object], [Object], [Object]],
      milestone: null,
      draft: false,
      commits_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1216/commits",
      review_comments_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/1216/comments",
      review_comment_url:
        "https://api.github.com/repos/rotabull/rotabull/pulls/comments{/number}",
      comments_url:
        "https://api.github.com/repos/rotabull/rotabull/issues/1216/comments",
      statuses_url:
        "https://api.github.com/repos/rotabull/rotabull/statuses/5ef925fc639b353ebdc24c4c55df3dcb507b1a40",
      head: {
        label: "rotabull:feature/ch3332/september-ui-clean-up",
        ref: "feature/ch3332/september-ui-clean-up",
        sha: "5ef925fc639b353ebdc24c4c55df3dcb507b1a40",
        user: [Object],
        repo: [Object],
      },
      base: {
        label: "rotabull:master",
        ref: "master",
        sha: "932d2bcb0daefd2afc3d172e1640f78c0ebad989",
        user: [Object],
        repo: [Object],
      },
      _links: {
        self: [Object],
        html: [Object],
        issue: [Object],
        comments: [Object],
        review_comments: [Object],
        review_comment: [Object],
        commits: [Object],
        statuses: [Object],
      },
      author_association: "COLLABORATOR",
      active_lock_reason: null,
    },
  ];

  return closedPrResponseData;
}
