# Linux Exchange

### What is this?

Creating and maintaining a distribution of Linux is hard enough without operating a network of mirrors.

What if we could combine the convenience of downloading large files via http in the web browser, with the scalability and efficiency of torrenting? This website serves as a demo for downloading Linux ISOs via [WebTorrent](https://webtorrent.io/faq), entirely on a static site.

That means that the more people that use this website, and the more distros that integrate WebTorrent for distribution of their installation media, the faster it gets for everyone! If you maintain a version of Linux, it's easier than ever to distribute your installation media peer-to-peer, no mirror network required.

### I want to help!

Awesome! Consider becoming a WebTorrent seedbox that hosts this content. You can use [the Linux Exchange website](https://linux.exchange/) itself.

If you have thoughts about enhancing the code, design, or backend automation (currently trying out [Github Actions](https://github.com/leoherzog/LinuxExchange/tree/master/.github)) of this website, I'd be happy to review Pull Requests. The magic of WebTorrent is, you can fork this code and publish your own version... They'll still talk to each other, regardless of domain!

### The Catalog

`distros.db` is the catalog. It is a SQLite database holding every distro and image the site offers, plus every image it has listed before and when. The page reads it directly, and anything else that wants the catalog can fetch it from the site. The schema lives in `.github/schema.sql`, and the `listing_history` view is the easiest way to query the history.

All writes go through `.github/catalog.js`. The updater scripts read the catalog as an object shaped like the old `distros.json`, change it, and write it back. A write that changes something adds one row to the `revision` table. A write that changes nothing leaves the file byte for byte as it was.

To edit the catalog by hand, export it to JSON, edit the `catalog` object in that file, and import it again. Use Node 24.2 or newer, and keep the JSON file out of the commit.

```sh
git pull
node .github/catalog.js export catalog.json
# edit the "catalog" object in catalog.json
node .github/catalog.js import catalog.json "Describe the change"
git add distros.db && git commit -m "Describe the change" && git push
```

The export records which revision it came from, and the import refuses the file if the database has moved on since. When that happens, export again and redo the edit. The import also refuses a catalog with a broken structure, and it warns when a distro's recommended image changes, which usually means a `recommended-version-index` needs adjusting. Don't change `distros.db` with other SQLite tools, because the history tables depend on every write going through `catalog.js`.

The updater workflows commit `distros.db` every few hours, so your push can be rejected because the bot committed in the meantime. A binary database cannot be merged. Drop your commit with `git fetch && git reset --hard origin/main`, then export, edit, import, and commit again.

### License

Feel free to take a look at the source and adapt as you please. This source is licensed as follows:

[![Creative Commons License](https://i.creativecommons.org/l/by-sa/4.0/88x31.png)](http://creativecommons.org/licenses/by-sa/4.0/)

Linux Exchange is licensed under a [Creative Commons Attribution-ShareAlike 4.0 International License](http://creativecommons.org/licenses/by-sa/4.0/).

---

#### About Me

<a href="https://herzog.tech/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/link-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/link.svg.png">
    <img src="https://herzog.tech/signature/link.svg.png" width="32px">
  </picture>
</a>
<a href="https://mastodon.social/@herzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/mastodon-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/mastodon.svg.png">
    <img src="https://herzog.tech/signature/mastodon.svg.png" width="32px">
  </picture>
</a>
<a href="https://github.com/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/github-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/github.svg.png">
    <img src="https://herzog.tech/signature/github.svg.png" width="32px">
  </picture>
</a>
<a href="https://keybase.io/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/keybase-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/keybase.svg.png">
    <img src="https://herzog.tech/signature/keybase.svg.png" width="32px">
  </picture>
</a>
<a href="https://www.linkedin.com/in/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/linkedin-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/linkedin.svg.png">
    <img src="https://herzog.tech/signature/linkedin.svg.png" width="32px">
  </picture>
</a>
<a href="https://hope.edu/directory/people/herzog-leo/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/anchor-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/anchor.svg.png">
    <img src="https://herzog.tech/signature/anchor.svg.png" width="32px">
  </picture>
</a>
<br />
<a href="https://herzog.tech/$" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/mug-tea-saucer-solid-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/mug-tea-saucer-solid.svg.png">
    <img src="https://herzog.tech/signature/mug-tea-saucer-solid.svg.png" alt="Buy Me A Tea" width="32px">
  </picture>
  Found this helpful? Buy me a tea!
</a>
