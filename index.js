const core = require("@actions/core");
const axios = require("axios").default;
const moment = require("moment");

const REPO = "rotabull";
const OWNER = "rotabull";
const CLUBHOUSE_BASE_URL = "https://app.clubhouse.io/rotabull/story/";
const HEROKU_API_BASE_URL = "https://api.heroku.com";
const GITHUB_API_BASE_URL = "https://api.github.com";
const PROMOTE_RETRIES = 10;
const PROMOTE_TIME_OUT = 20000;
const CHECK_STATUS_RETRIES = 20;
const CHECK_STATUS_TIME_OUT = 60000;
const newLine = "\r\n";

async function run() {
  let actionType = core.getInput("action-type");

  try {
    if (actionType === "release") {
      getLastReleaseSHA().then((lastReleaseSHA) => {
        collectNewCommitSHAs(lastReleaseSHA).then((newPrSHAs) => {
          createGithubRelease(newPrSHAs);
        });
      });
    } else if (actionType === "promote") {
      promoteOnHeroku().then((id) => {
        console.log("Promotion ID is set to " + id);
        checkPromotionStatus(id, PROMOTE_RETRIES, PROMOTE_TIME_OUT);
      });
    } else if (actionType === "check-status") {
      getLastHerokuReleaseStatus(CHECK_STATUS_RETRIES, CHECK_STATUS_TIME_OUT);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

function getLastHerokuReleaseStatus(retries, timeout) {
  const SOURCE_APP_ID = core.getInput("source-app-id");
  const HEROKU_API_KEY = core.getInput("heroku-api-key");

  const herokuReleaseURL = `${HEROKU_API_BASE_URL}/apps/${SOURCE_APP_ID}/releases`;
  const options = {
    headers: {
      Accept: "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json",
      Authorization: `Bearer ${HEROKU_API_KEY}`,
      Range: "version; order=desc",
    },
  };

  axios
    .get(herokuReleaseURL, options)
    .then((response) => {
      console.log(
        "checking last release status for source app " + retries + "..."
      );
      var status = null;

      if (response.data && response.data.length === 0) {
        status = "succeeded";
      } else {
        console.log(response.data[0]);
        status = response.data[0].status; //get the most recent
      }

      if (status === "succeeded" || status === "failed") {
        core.setOutput("source-app-status", status);
      } else {
        if (retries > 0) {
          setTimeout(() => {
            return getLastHerokuReleaseStatus(retries - 1, timeout);
          }, timeout);
        } else {
          core.setOutput("source-app-status", "RETRY MAXIMUM REACHED");
        }
      }
    })
    .catch((error) => {
      console.log(error);
    });
}
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

function getGithubAPIHeader(acceptHeader) {
  const githubToken = core.getInput("github-token");

  const options = {
    headers: {
      Accept: acceptHeader,
      "Content-Type": "application/json",
      Authorization: `token ${githubToken}`,
    },
  };
  return options;
}

// returns the last commit sha included in the last release
function getLastReleaseSHA() {
  const options = getGithubAPIHeader("application/vnd.github.v3+json");
  const getGithubTagsUrl = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/tags`;
  return axios
    .get(getGithubTagsUrl, options)
    .then((response) => {
      const lastTag = response.data === [] ? null : response.data[0].name;
      const lastReleaseSHA =
        response.data === [] ? null : response.data[0].commit.sha;
      console.log("Last Release SHA:" + lastReleaseSHA);
      const nextReleaseTag = getNextReleaseTag(
        lastTag,
        moment().format("YYYY.MM.DD")
      );

      core.setOutput("release-tag", nextReleaseTag);
      core.setOutput("release-title", `Release ${nextReleaseTag}`);
      return lastReleaseSHA;
    })
    .catch((error) => {
      console.log(error);
    });
}

function collectNewCommitSHAs(lastReleaseSHA) {
  const options = getGithubAPIHeader("application/vnd.github.v3+json");
  const getGithubCommitsURl = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/commits`;
  var collectedSHAs = [];
  console.log("last commit sha is " + lastReleaseSHA);
  return axios
    .get(getGithubCommitsURl, options)
    .then((response) => {
      const data = response.data;
      for (var i = 0, n = data.length; i < n; ++i) {
        if (data[i].sha === lastReleaseSHA) break;
        collectedSHAs[collectedSHAs.length] = data[i].sha;
      }
      console.log("CollectedSHAs are:" + collectedSHAs);
      return collectedSHAs;
    })
    .catch((error) => {
      console.log(error);
    });
}

function createGithubRelease(collectedSHAs) {
  let promises = [];
  var collection = {
    Feature: [],
    Bugfix: [],
    Chore: [],
  };

  // for (var i = 0, n = collectedSHAs.length; i < n; ++i) {
  for (var i = 0, n = 1; i < n; ++i) {
    promises.push(
      // getPRDetails(collectedSHAs[i]).then((response) => {
      getPRDetails("824250878f21545e4eff33fc5a3cfcd4d3b9afa3").then(
        (response) => {
          const { category, title, clubhouseNumber } = response;
          saveToCollection(collection, category, title, clubhouseNumber);
        }
      )
    );
  }

  Promise.all(promises)
    .then(() => {
      const releaseBody = composeReleaseBody(collection);
      console.log("Release body will be: " + releaseBody);
      core.setOutput("release-body", releaseBody);
    })
    .catch((error) => {
      console.log("something wrong");
      console.log(error);
    });
}

function getPRDetails(commitSHA) {
  const options = getGithubAPIHeader(
    "application/vnd.github.groot-preview+json"
  );
  console.log("debug2");
  const getPRDetailsURL = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/commits/${commitSHA}/pulls`;
  // const getPRDetailsURl =
  //   "https://api.github.com/repos/rotabull/rotabull/commits/824250878f21545e4eff33fc5a3cfcd4d3b9afa3/pulls";
  return axios
    .get(getPRDetailsURL, options)
    .then((response) => {
      var data = response.data;
      console.log("debug:");
      console.log(data);
      if (data && data.length !== 0) {
        const prTitle = data[0].title;
        const prBody = data[0].body;
        const branchName = data[0].head.ref;

        const category = extractCategory(branchName);
        const title = extractTitleIgnoringClubhouseNumber(prTitle);
        const clubhouseNumber = extractClubhouseStoryNumber(prTitle, prBody);

        return { category, title, clubhouseNumber };
      } else {
        return getCommitDetail(commitSHA);
      }
    })
    .catch((error) => {
      console.log(error);
    });
}

function getCommitDetail(commitSHA) {
  const options = getGithubAPIHeader(
    "application/vnd.github.groot-preview+json"
  );
  console.log("debug2");
  const getPRDetailsURL = `${GITHUB_API_BASE_URL}/repos/${OWNER}/${REPO}/commits/${commitSHA}`;

  return axios
    .get(getPRDetailsURL, options)
    .then((response) => {
      var data = response.data;
      console.log("debug commit detail:");

      if (data && data.length !== 0) {
        const commitMessage = data.commit.message;
        console.log("debug commit detail2:" + data.commit.message);
        const category = extractCategory(commitMessage);
        console.log("category:" + category);
        const title = extractTitleIgnoringClubhouseNumber(commitMessage);
        const clubhouseNumber = extractClubhouseStoryNumber(
          commitMessage,
          commitMessage
        );

        return { category, title, clubhouseNumber };
      }
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
      const subheader = newLine + labels[category] + newLine;
      notes += subheader;
      titlesCollection.forEach((element) => {
        notes += newLine + "* " + element + newLine;
      });
    }
  }

  if (totalPRCount > 0) return header + notes;
  return notes;
}

function saveToCollection(collection, category, title, PRClubhouseNumber) {
  const clubhouseNumber = PRClubhouseNumber
    ? `[ch${PRClubhouseNumber}]`
    : "[NoStoryID]";
  const content = `${title} ${clubhouseNumber}(${CLUBHOUSE_BASE_URL}${PRClubhouseNumber})`;
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
  var rx = /https:\/\/app\.clubhouse\.io\/rotabull\/story\/[0-9]+/g;
  var arr = body.match(rx);
  if (arr === null) return null;
  const data = arr[0].split("/");
  return data[data.length - 1];
}

function extractClubhouseNumberFromPRTitle(title) {
  var rx = /\[ch[0-9]+\]/g;
  var arr = title.match(rx);
  if (arr === null) return null;

  var rx2 = /[0-9]+/g;
  return arr[0].match(rx2)[0];
}

function extractCategory(branchName) {
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
  var rx = /\[ch[0-9]+\]/g;
  var rx2 = /[0-9]+/g;
  var arr = body.match(rx);
  if (arr === null) return null;
  const newArray = arr.map((element) => element.match(rx2)[0]);
  return newArray;
}

function extractTitleIgnoringClubhouseNumber(title) {
  const rx = /\[ch[0-9]+\]/g;
  const replaceWith = "";
  const after = title.replace(rx, replaceWith);
  return after.trim();
}
function getNextReleaseTag(lastReleaseTag, todayDate) {
  console.log("Last release tag is " + lastReleaseTag);

  if (lastReleaseTag === null) return `v${todayDate}`;
  if (lastReleaseTag === `v${todayDate}`) {
    return `${lastReleaseTag}.1`;
  } else if (lastReleaseTag.includes(todayDate)) {
    const splitted = lastReleaseTag.split(".");
    const newVersionNum = parseInt(splitted[splitted.length - 1]) + 1;
    return `v${todayDate}.${newVersionNum}`;
  } else {
    return `v${todayDate}`;
  }
}

module.exports = {
  checkPromotionStatus: checkPromotionStatus,
  collectNewCommitSHAs: collectNewCommitSHAs,
  createGithubRelease: createGithubRelease,
  getLastHerokuReleaseStatus: getLastHerokuReleaseStatus,
  getLastReleaseSHA: getLastReleaseSHA,
  getPRDetails: getPRDetails,
  extractAllClubhouseNumbersFromLastRelease: extractAllClubhouseNumbersFromLastRelease,
  extractClubhouseStoryNumber: extractClubhouseStoryNumber,
  extractClubhouseNumberFromPRTitle: extractClubhouseNumberFromPRTitle,
  extractClubhouseNumberFromPRBody: extractClubhouseNumberFromPRBody,
  extractCategory: extractCategory,
  extractTitleIgnoringClubhouseNumber: extractTitleIgnoringClubhouseNumber,
  composeReleaseBody: composeReleaseBody,
  getNextReleaseTag: getNextReleaseTag,
  promoteOnHeroku: promoteOnHeroku,
  saveToCollection: saveToCollection,
};
