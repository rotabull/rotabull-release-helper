# Rotabull Release Helper action

This action creates a release notes body OR promotes a source app to a target app on Heroku based on `action-type` the workflow defines.
Please see repo: https://github.com/rotabull/rotabull-release-helper


## Inputs

### `github-token`

**Required** github token. Generated by github workflow

### `action-type`

**Required** The name of the person to greet. Either "promote" or "release" or "check-status"

### `heroku-api-key`

**Required** Heroku API Key. 

### `pipeline-id`

**Required** Heroku Pipeline ID

### `source-app-id`

**Required** Heroku Source App ID we want to promote from

### `target-app-id`

**Required** Heroku Target App ID we want to promote to

## Outputs

### `release-title`

Github Release title

### `release-tag`

Github Release Tag

### `release-body`

Github Release Body / Notes

### `promotion-status`

Heroku Promotion Status

### `source-app-status`

Last Heroku Release Status

## Example usage

```yaml
uses: rotabull/rotabull-release-helper@main
with:
  github-token: '123'
  action-type: "promote"
  ......
```
