const moment = require("moment");
const axios = require("axios");
const core = require("@actions/core");
const main = require("../index.js");

//example of mocking @actions/core and @actions/github
//https://github.com/actions/checkout/blob/master/__test__/input-helper.test.ts
jest.mock("axios");
var inputs = {
  "heroku-api-key": "heroku12346",
  "pipeline-id": "pipelineid1234",
  "source-app-id": "staging1234",
  "target-app-id": "production12345",
  "github-token": "some-random-token",
};

var outputs = {
  "promote-status": undefined,
  "release-body": undefined,
  "release-title": undefined,
  "release-tag": undefined,
};

describe("index.js", () => {
  beforeAll(() => {
    jest.spyOn(core, "getInput").mockImplementation((name) => {
      return inputs[name];
    });

    jest.spyOn(core, "setOutput").mockImplementation((name, value) => {
      outputs[name] = value;
    });
  });

  describe("promoteOnHeroku", () => {
    test("calls the heroku pipeline promotion api and returns the promotion id", () => {
      const params = {
        headers: {
          Accept: "application/vnd.heroku+json; version=3",
          Authorization: "Bearer heroku12346",
          "Content-Type": "application/json",
        },
      };
      const response = {
        data: {
          id: "some-promotion-id-returned-by-api",
        },
      };

      const expectedPayload = {
        pipeline: {
          id: inputs["pipeline-id"],
        },
        source: {
          app: {
            id: inputs["source-app-id"],
          },
        },
        targets: [
          {
            app: {
              id: inputs["target-app-id"],
            },
          },
        ],
      };
      axios.post.mockImplementationOnce(() => Promise.resolve(response));

      const herokuPromotionID = main.promoteOnHeroku();

      expect(axios.post).toHaveBeenCalledWith(
        "https://api.heroku.com/pipeline-promotions",
        expectedPayload,
        params
      );

      //https://jestjs.io/docs/en/asynchronous#promises
      return herokuPromotionID.then((id) => {
        expect(id).toBe("some-promotion-id-returned-by-api");
      });
    });
  });

  describe("checkPromotionStatus", () => {
    test("calls the heroku check promotion status api", () => {
      const params = {
        headers: {
          Accept: "application/vnd.heroku+json; version=3",
          Authorization: "Bearer heroku12346",
          "Content-Type": "application/json",
        },
      };
      const response = {
        data: {
          status: "completed",
        },
      };

      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      main.checkPromotionStatus("1234", 1, 10000);
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.heroku.com/pipeline-promotions/1234",
        params
      );
      setImmediate(() => {
        expect(outputs["promote-status"]).toBe("completed");
      });
    });
  });

  describe("getLastRelease", () => {
    test("calls get last release github api and returns valid clubhouse numbers array", () => {
      const options = {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          Authorization: `token some-random-token`,
        },
      };

      const response = {
        data: {
          tag_name: "v1.13.1",
          body: "blah blah blah [ch12345], [ch0909], [ch7789] blah blah blah",
        },
      };
      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      const clubhouseNumbers = main.getLastRelease();
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/releases/latest",
        options
      );
      return clubhouseNumbers.then((numbers) => {
        expect(numbers.includes("0909")).toBe(true);
        expect(numbers.includes("7789")).toBe(true);
      });
    });
  });

  describe("createGithubRelease", () => {
    test("calls get closed PRs Github API and sets release body", () => {
      const releasedClubhouseNumber = ["3331"];
      const options = {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          Authorization: `token some-random-token`,
        },
      };
      const response = {
        data: [
          {
            title: "Demo/context 2",
            merged_at: null,
            body: "blablah",
            head: {
              ref: "demo/context-2",
            },
          },
          {
            title:
              "[ch3681] Properly display/download attachments from an email quote",
            merged_at: "2020-09-11T23:37:25Z",
            body: "blablah2",
            head: {
              ref: "bug/ch3681",
            },
          },
          {
            title:
              "Change Quickbooks invoice worker to run every 10 minutes [ch3644]",
            merged_at: "2020-09-10T17:52:50Z",
            body: "blablah3",
            head: {
              ref: "bugfix/qbo-sync-schedule",
            },
          },
          {
            title: "Clean up notification emails [ch3331]",
            merged_at: "2020-09-10T17:49:05Z",
            body: "blablah4",
            head: {
              ref: "feature/ch3331",
            },
          },
        ],
      };
      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      main.createGithubRelease(releasedClubhouseNumber);
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/pulls?state=closed",
        options
      );

      const expectedReleaseNote =
        "## What's Changed\r\n" +
        "\r\n" +
        "### Bugfixes -- 🐞\r\n" +
        "\r\n" +
        "* Properly display/download attachments from an email quote [ch3681](https://app.clubhouse.io/rotabull/story/3681)\r\n" +
        "\r\n" +
        "* Change Quickbooks invoice worker to run every 10 minutes [ch3644](https://app.clubhouse.io/rotabull/story/3644)\r\n";
      setImmediate(() => {
        expect(outputs["release-body"]).toBe(expectedReleaseNote);
      });
    });
  });

  describe("composeReleaseBody", () => {
    test("titles collection is empty returns an empty body", () => {
      const collection = {
        Feature: [],
        Bugfix: [],
        Chore: [],
      };
      const releaseBody = main.composeReleaseBody(collection);
      expect(releaseBody).toBe("");
    });
    test("titles collection contains at least 1 element returns an non-empty body", () => {
      const collection = {
        Feature: ["Story 1 [ch2222](www.google.com)"],
        Bugfix: ["Story 3 [ch1234](www.google3.com)"],
        Chore: ["Story 2 [ch3333](www.google2.com)"],
      };
      const releaseBody = main.composeReleaseBody(collection);

      expect(releaseBody).toBe(
        "## What's Changed\r\n\r\n### Features -- ⭐️\r\n" +
          "\r\n* Story 1 [ch2222](www.google.com)\r\n" +
          "\r\n### Bugfixes -- 🐞\r\n" +
          "\r\n* Story 3 [ch1234](www.google3.com)\r\n" +
          "\r\n### Chores -- ⚙\r\n" +
          "\r\n* Story 2 [ch3333](www.google2.com)\r\n"
      );
    });
  });

  describe("extractClubhouseNumberFromPRBody", () => {
    test("extracts clubhouse number from body", () => {
      const mockBody =
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
        "- [x] When applicable, story tested and accepted in Clubhouse using **Review App**\r\n";

      const clubhouseNumber = main.extractClubhouseNumberFromPRBody(mockBody);
      expect(clubhouseNumber).toBe("3681");
    });
  });

  describe("extractClubhouseNumberFromPRTitle", () => {
    test("extracts clubhouse title", () => {
      const title =
        "[ch3681] Properly display/download attachments from an email quote";
      const clubhouseNumber = main.extractClubhouseNumberFromPRTitle(title);
      expect(clubhouseNumber).toBe("3681");
    });
    test("return the first ocurrence only if there are more than one matched", () => {
      const title =
        "[ch3681] Properly display/download attachments from an email quote [ch1234]";
      const clubhouseNumber = main.extractClubhouseNumberFromPRTitle(title);
      expect(clubhouseNumber).toBe("3681");
    });
  });

  describe("extractCategory", () => {
    test("category matches the branch name prefix", () => {
      const arr = ["bug/", "bugfix/", "enhancement/", "feature/", "", "random"];
      const expected = [
        "Bugfix",
        "Bugfix",
        "Feature",
        "Feature",
        "Chore",
        "Chore",
      ];
      for (let i = 0; i < arr.length; i++) {
        const branchName = arr[i],
          expectedPrefix = expected[i],
          prefix = main.extractCategory(branchName);
        expect(prefix).toBe(expectedPrefix);
      }
    });
  });

  describe("extractAllClubhouseNumbersFromLastRelease", () => {
    test("last release body containing multiple clubhouse links returns an array", () => {
      const body =
        "## What’s Changed\r\n\r\n###  Chores -- ⚙️\r\n\r\n* Appcues installation improvements [ch3617]\r\n\r\n### Bugfixes -- 🐞\r\n\r\n* Price suggestion popover on repair form [ch3481](https://app.clubhouse.io/rotabull/story/3481)\r\n";
      const clubhouseNumbers = main.extractAllClubhouseNumbersFromLastRelease(
        body
      );
      expect(clubhouseNumbers.length).toBe(2);
      expect(clubhouseNumbers.includes("3617")).toBe(true);
      expect(clubhouseNumbers.includes("3481")).toBe(true);
    });
  });

  describe("extractTitleIgnoringClubhouseNumber", () => {
    test("extract clubhouse number correctly from clubhouse title", () => {
      const clubhouseTitle =
        "[ch3681] Properly display/download attachments from an email quote";
      expect(main.extractTitleIgnoringClubhouseNumber(clubhouseTitle)).toBe(
        "Properly display/download attachments from an email quote"
      );
    });
  });

  describe("getNextReleaseTag", () => {
    test("when last release is the same date as today, returns with a version number", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v${todayDate}`;
      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);

      expect(nextReleaseTag).toBe(`v${todayDate}.1`);
    });

    test("when last release tag is not the same date as today, returns today's date as version number", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v1990.01.20`;
      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);

      expect(nextReleaseTag).toBe(`v${todayDate}`);
    });
    test("release tag increases version number if a version number already exist", () => {
      const todayDate = moment().format("YYYY.MM.DD");
      const lastReleaseTag = `v${todayDate}.2`;
      const nextReleaseTag = main.getNextReleaseTag(lastReleaseTag, todayDate);

      expect(nextReleaseTag).toBe(`v${todayDate}.3`);
    });
  });
});
