# Security

## Reporting a problem

If an extension in this registry does something harmful, leaks data, escapes its sandbox, or the registry's own
tools or signing are at fault, tell the owners privately: use GitHub's **Report a vulnerability** on this repository
(Security, Advisories), or email `mackin@nodemode.ai`. Please do not open a public issue for something that could be
abused before it is fixed. Say which extension and version, what happens, and how to see it happen.

You get an answer within three working days. A harmful extension is blocked first and investigated after.

## The block list

`registry/blocklist.json` lists ids and versions that must not be used:

```json
{
  "format": "formext-blocklist",
  "format_version": 1,
  "blocked": [
    { "id": "some-extension", "versions": ["0.2.0"], "reason": "sends the open document to a third party", "date": "2026-11-07" }
  ]
}
```

`versions` names exact `x.y.z` versions, or is `["*"]` for every version. A change to it goes through a pull request
like any other, approved by an owner. On merge, the `publish` workflow:

- leaves blocked extensions out of `extensions.json`, so no client offers them;
- publishes the list itself as `https://github.com/nodemode-dev/form.ext-registry/releases/download/index/blocklist.json`,
  signed with the registry key in `blocklist.json.sig`.

FormPortal reads the signed block list and turns a blocked extension off in every app (it rewrites the app's
`enabled.json`, which each app picks up while it runs), and says why. A block list whose signature does not verify
is ignored and reported, never trusted.

Releases of blocked versions are not deleted (published bytes never change), but no client installs them.

## Signatures

Every package is signed by the `nodemode` publisher key and the index and block list by the registry key, both
Ed25519. The private keys exist only as this repository's secrets (`PUBLISHER_SIGNING_KEY`, `REGISTRY_SIGNING_KEY`);
[KEYS.md](KEYS.md) says how they are made and replaced. If a private key may have leaked, the owners make a new pair,
replace the secret and the public key everywhere KEYS.md lists, and publish again; clients built with only the old
key refuse the new index until they update, which is the point.
