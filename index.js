const core = require("@actions/core");
const github = require("@actions/github");
const axios = require("axios").default;
const moment = require("moment");

async function run() {
  try {
    // `who-to-greet` input defined in action metadata file
    const nameToGreet = core.getInput("who-to-greet");
    const githubToken = core.getInput("github-token");
    console.log(`Github Token is ${githubToken}`);
    console.log(`Hello ${nameToGreet}!`);

    const time = new Date().toTimeString();
    core.setOutput("time", time);

    // Get the JSON webhook payload for the event that triggered the workflow
    const payload = JSON.stringify(github.context.payload, undefined, 2);
    console.log(`The event payload: ${payload}`);

    // Generate tag date
    // 1. get last release tag which draft == false and prerelease == false; 2. see if it matches certain format and is today's date
    // 3. If not, use today's date; otherwise increment today's date by like .1,
    // 4. If it does not match the certain format, then use today's date as a starting point
    // call curl \
    // -X GET https://api.github.com/repos/$OWNER/$REPO/releases \
    // -H "Content-Type: application/json" \
    // -H "Authorization: token $GITHUB_TOKEN" \
    const response = getTestResponse();

    const options = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${githubToken}`,
      },
    };

    const getLatestReleaseUrl =
      "https://api.github.com/repos/rotabull/rotabull/releases/latest";
    axios
      .get(getLatestReleaseUrl, options)
      .then((response) => {
        console.log("response is:");
        console.log(response.data);
        const nextReleaseTag = getNextReleaseTag(response.data.tag_name);
        core.setOutput("release-tag", nextReleaseTag);
        core.setOutput("release-title", `Release ${nextReleaseTag}`);
        console.log("new release tag will be " + nextReleaseTag);
        console.log("new release title will be " + `Release ${nextReleaseTag}`);
      })
      .catch((error) => {
        console.log(error);
      });

    const getPullRequestsUrl =
      "https://api.github.com/repos/rotabull/rotabull/commits";

    let exampleSha = "";
    axios
      .get(getPullRequestsUrl, options)
      .then((response) => {
        console.log("Commits Response:");
        console.log(response.data);

        exampleSha = response.data[0].sha;

        response.data.forEach((element) => {
          console.log("Commit Message: " + element.commit.message);
          console.log("Commit Author:" + element.commit.author.name);
        });
      })
      .catch((error) => {
        console.log(error);
      });

    const commitDetailUrl = `https://api.github.com/repos/rotabull/rotabull/commits/${exampleSha}`;
    axios
      .get(commitDetailUrl, options)
      .then((response) => {
        console.log("Example Commit Detail Response:");
        console.log(response.data);
      })
      .catch((error) => {
        console.log(error);
      });
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

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
function getTestResponse() {
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
