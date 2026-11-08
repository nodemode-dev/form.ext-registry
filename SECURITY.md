# Security policy

## Supported versions

The registry has no releases to install: what counts is what `main` publishes. Security fixes go into `main` and the
next `publish` run, and a harmful extension is handled through the block list below, whatever version it is.

| What | Supported |
| --- | --- |
| The registry's tools, workflows and signed index on `main` | Yes |
| The newest published version of each listed extension | Yes |
| Older versions of an extension | Blocked if affected; not fixed in place (published bytes never change) |

## Reporting a problem

If an extension in this registry does something harmful, leaks data, escapes its sandbox, or the registry's own
tools or signing are at fault, tell the owners privately: use GitHub's **Report a vulnerability** on this repository
(Security, Advisories), or email `mackin@nodemode.ai`. Please do not open a public issue for something that could be
abused before it is fixed. Say which extension and version, what happens, and how to see it happen.

You get an answer within three working days. A harmful extension is blocked first and investigated after. We keep
you informed while it is fixed and credit you in the changelog, unless you would rather not be named.

A problem in form.ext itself (the studio's engine, terminal, preview or packaging on your own machine) belongs to
[form.ext's security policy](https://github.com/nodemode-dev/form.ext/security); a problem in how a Form app hosts
extensions belongs to that app's repository.

## What counts

Every Form app trusts what this registry signs, so the things that matter most are the ways something harmful could
be listed, or something listed could do more than it was reviewed to do:

- **Extensions**: a listed extension that escapes the contract's sandbox, uses a permission it was not granted,
  reaches the network other than through `net.fetch`, runs code that is not in its package, hides what it does from
  its README, or sends a person's documents or data anywhere they were not told about.
- **The checks** (`tools/check.py`): a way to get an extension past any of the seven checks in
  [POLICY.md](POLICY.md) while breaking the rule it enforces, such as hidden dynamic code, an undeclared permission or
  a package that is not built from its source.
- **Building and signing** (`tools/build_index.py`, the `publish` workflow): a pull request that can change a
  published version's bytes, sign something that was not reviewed and merged, reach the signing secrets, or make
  the workflows run code from a submission with those secrets available.
- **The index and the block list**: anything that lets a client accept an index or block list the registry did not
  sign, list a blocked version, or keep a blocked extension turned on.
- **Publishers**: impersonating another publisher, or getting a key into `registry/publishers.json` without the
  owners' review.

An extension that is merely broken, slow or ugly is an ordinary bug: open an issue that names it.

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
