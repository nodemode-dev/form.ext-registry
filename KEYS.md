# Keys

The registry uses two Ed25519 key pairs. The private halves live only in this repository's GitHub secrets. The
public halves are committed where readers need them.

| Key | Signs | Secret | Public key goes into |
|---|---|---|---|
| Registry | `extensions.json` and `blocklist.json` (the `.sig` files) | `REGISTRY_SIGNING_KEY` | FormPortal, form.ext and formai.studio key files (below) |
| Publisher `nodemode` | every `.formpkg` (the entry's `signature`) | `PUBLISHER_SIGNING_KEY` | `registry/publishers.json`, which the index copies |

Both secrets are base64 of the raw 32-byte Ed25519 seed. Signatures are base64 of the 64-byte Ed25519 signature
over the exact bytes of the file, which is what FormPortal's `core/src/signature.rs` `verify()` checks.

Until the owners do the steps below, the key files hold comment lines only, and every client refuses the registry
index with "this build trusts no registry key yet" unless its developer setting allows unsigned indexes.

## 1. Make the two key pairs

On a computer you trust, in a clone of this repository:

```sh
pip install -r tools/requirements.txt
python3 tools/new_signing_key.py registry
python3 tools/new_signing_key.py publisher
```

Each prints a private key and a public key. Do not save the private keys in a file in the repository, a note, a chat
or a ticket. Copy each one straight into its secret in the next step, then clear the terminal.

## 2. Add the private keys as repository secrets

GitHub, `nodemode-dev/form.ext-registry`, Settings, Secrets and variables, Actions, New repository secret:

- `REGISTRY_SIGNING_KEY`: the registry private key.
- `PUBLISHER_SIGNING_KEY`: the publisher private key.

Or with the GitHub CLI, which reads the value from the prompt so it never reaches your shell history:

```sh
gh secret set REGISTRY_SIGNING_KEY -R nodemode-dev/form.ext-registry
gh secret set PUBLISHER_SIGNING_KEY -R nodemode-dev/form.ext-registry
```

## 3. Commit the public keys

- **This repository:** put the publisher public key into `registry/publishers.json` as `public_key` of `nodemode`.
  `build_index.py` refuses to build when the secret and this key disagree.
- **FormPortal:** add the registry public key on its own line in `core/registry_keys.txt` (compiled in).
- **form.ext:** add it on its own line in `backend/app/registry_keys.txt`.
- **formai.studio:** add it on its own line in `catalog/registry_keys.txt`, which the site's registry sync reads.

All three key files take one base64 key per line and ignore lines starting with `#`. For testing, every reader also
accepts extra keys from `FORMEXT_REGISTRY_PUBKEY` (comma-separated), so throwaway keys never need committing.

## 4. Publish

Push to `main` (or re-run the latest `publish` workflow). It signs every package and the index, releases new
versions and uploads the signed index and block list to the `index` release. Then release the client builds that
carry the new key.

## Replacing a key

Make a new pair as in step 1, replace the secret, replace the public key in every file listed in step 3, and publish.
For a rotation without a gap, add the new registry public key to the client key files first (a key file may hold
several lines), release the clients, then switch the secret and remove the old line later. A leaked key is replaced
at once, without waiting for clients.
