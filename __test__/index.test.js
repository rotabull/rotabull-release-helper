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
  "source-app-status": undefined,
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

  describe("getLastHerokuReleaseStatus", () => {
    test("calls the heroku release promotion status api", () => {
      const params = {
        headers: {
          Accept: "application/vnd.heroku+json; version=3",
          Authorization: "Bearer heroku12346",
          "Content-Type": "application/json",
          Range: "version; order=desc",
        },
      };

      const response1 = {
        data: [
          {
            status: "succeeded",
          },
          {
            status: "succeeded",
          },
        ],
      };

      axios.get.mockReturnValueOnce(Promise.resolve(response1));

      main.getLastHerokuReleaseStatus(20, 60000);

      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.heroku.com/apps/staging1234/releases",
        params
      );

      setImmediate(() => {
        expect(outputs["source-app-status"]).toBe("succeeded");
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

  describe("getLastReleaseSHA", () => {
    test("calls get tags github api and returns last releasee SHA", () => {
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
            name: "v2020.09.21",
            commit: {
              sha: "35b00319d847052f5967281e821e3b609ca1f538",
              url:
                "https://api.github.com/repos/rotabull/rotabull/commits/35b00319d847052f5967281e821e3b609ca1f538",
            },
            node_id: "MDM6UmVmMTIzNDg2Mjk3OnJlZnMvdGFncy92MjAyMC4wOS4yMQ==",
          },
          {
            name: "v2020.09.17.1",
            commit: {
              sha: "56bf641f43112715ce18ac9a3b2f858966d048c2",
              url:
                "https://api.github.com/repos/rotabull/rotabull/commits/56bf641f43112715ce18ac9a3b2f858966d048c2",
            },
            node_id: "MDM6UmVmMTIzNDg2Mjk3OnJlZnMvdGFncy92MjAyMC4wOS4xNy4x",
          },
        ],
      };
      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      const releaseSHA = main.getLastReleaseSHA();
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/tags",
        options
      );
      return releaseSHA.then((sha) => {
        expect(sha).toBe("35b00319d847052f5967281e821e3b609ca1f538");
      });
    });
  });

  describe("collectionNewCommitSHAs", () => {
    test("calls the github commits API and returns an array of commit SHAs for the upcoming release", () => {
      const options = {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          Authorization: `token some-random-token`,
        },
      };
      const lastSHA = "64bda140bc4eea1a99fbc981a0b24eae8bec1745";
      const response = {
        data: [
          {
            sha: "6466b8eb22ddce5d6dd68c665318207037756cb0",
          },
          {
            sha: "982a7b9edb0f4a4305141c11868ce7bcd3b18e4e",
          },
          {
            sha: "174bfd8609ca9227d498df0c443858fceea51a20",
          },
          {
            sha: "b0af03289aff7d7e62bb80e9fe4444caa7943b2f",
          },
          {
            sha: lastSHA,
          },
          {
            sha: "1a4485d7466256915a1d50439b580e9d26b78864",
          },
          {
            sha: "f5434291f82428d024e236f0e250b72151c3ec11",
          },
        ],
      };
      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      const promise = main.collectNewCommitSHAs(lastSHA);
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/commits",
        options
      );
      return promise.then((array) => {
        expect(array).toEqual([
          "6466b8eb22ddce5d6dd68c665318207037756cb0",
          "982a7b9edb0f4a4305141c11868ce7bcd3b18e4e",
          "174bfd8609ca9227d498df0c443858fceea51a20",
          "b0af03289aff7d7e62bb80e9fe4444caa7943b2f",
        ]);
      });
    });
  });

  describe("getPRDetail", () => {
    test("calls the commit pulls github api and returns categroy, title, and clubhouse number for a particular commit", () => {
      const options = {
        headers: {
          Accept: "application/vnd.github.groot-preview+json",
          "Content-Type": "application/json",
          Authorization: `token some-random-token`,
        },
      };
      const response = {
        data: [
          {
            title:
              "[ch3681] Properly display/download attachments from an email quote",
            merged_at: "2020-09-11T23:37:25Z",
            body: "blablah2",
            head: {
              ref: "bug/ch3681",
            },
          },
        ],
      };

      axios.get.mockImplementationOnce(() => Promise.resolve(response));
      const promise = main.getPRDetails("random-sha");
      expect(axios.get).toHaveBeenCalledWith(
        "https://api.github.com/repos/rotabull/rotabull/commits/random-sha/pulls",
        options
      );
      return promise.then((res) => {
        expect(res).toEqual({
          category: "Bugfix",
          title: "Properly display/download attachments from an email quote",
          clubhouseNumber: "3681",
        });
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
  describe("saveToCollection", () => {
    test("if Clubhouse number is null", () => {
      var collection = {
        Feature: [],
        Bugfix: [],
        Chore: [],
      };

      const category = "Bugfix";
      const clubhouseNumber = null;
      const title = "Story 1";

      const expectedCollection = {
        Feature: [],
        Bugfix: [
          "Story 1 [NoStoryID](https://app.clubhouse.io/rotabull/story/null)",
        ],
        Chore: [],
      };
      main.saveToCollection(collection, category, title, clubhouseNumber);
      expect(collection).toEqual(expectedCollection);
    });

    test("if Clubhouse number is not null", () => {
      var collection = {
        Feature: [],
        Bugfix: [],
        Chore: [],
      };

      const category = "Feature";
      const clubhouseNumber = "1234";
      const title = "Story 1";
      const expectedCollection = {
        Feature: [
          "Story 1 [ch1234](https://app.clubhouse.io/rotabull/story/1234)",
        ],
        Bugfix: [],
        Chore: [],
      };
      main.saveToCollection(collection, category, title, clubhouseNumber);
      expect(collection).toEqual(expectedCollection);
    });
  });
  describe("extractClubhouseStoryNumber", () => {
    test("returns clubhouse number when PR title contains clubhouse number", () => {
      const title = "test [ch1234]";
      const body = "I don't know";
      const chNumber = main.extractClubhouseStoryNumber(title, body);

      expect(chNumber).toEqual("1234");
    });
    test("returns clubhouse number from PR body if PR title does not contain clubhouse number", () => {
      const title = "I don't have a number";
      const body =
        "https://app.clubhouse.io/rotabull/story/3860/release-actions-improvements-clean-up";
      const chNumber = main.extractClubhouseStoryNumber(title, body);

      expect(chNumber).toEqual("3860");
    });
    test("returns null if no clubhouse number found in both PR title and body", () => {
      const title = "hey[ch";
      const body = "https://app.clubhouse.io/rotabull/story/STORY_ID";
      const chNumber = main.extractClubhouseStoryNumber(title, body);

      expect(chNumber).toEqual(null);
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
