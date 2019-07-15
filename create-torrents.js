#!/usr/bin/env node

const fs = require('fs');
const Webtorrent = require('webtorrent');
const getJSON = require('get-json');
const rimraf = require('rimraf');
const chalk = require('chalk');

var downloader = new Webtorrent();

const dir = './torrent-files';
var urls = [];

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

getJSON('https://linux.exchange/distros.json', function (error, response) {

  if (error) {
    console.log(error.message);
    process.exit();
  }

  for (var i in response.distros) {
    for (var j in response.distros[i].versions) {
      var url = response.distros[i].versions[j]["magnet-url"];
      var name = url.split("dn=")[1];
      if (response.distros[i].trackers.length) {
        url += "&tr=" + response.distros[i].trackers.join("&tr=");
      }
      url += "&tr=" + response.trackers.join("&tr=");
      url += "&ws=https://cors.linux.exchange/" + name;
      // console.log(url + '\n');
      // fs.appendFileSync('./magnets.txt', url + '\n');
      urls.push({ "name": name, "url": url });
    }
  }

  console.log("Starting download of " + urls.length + " torrents...");

  rimraf(dir + '/*', function () { console.log("Cleared out old torrent files"); });

  for (var i in urls) {
    // console.log(urls[i] + "\n");
    downloader.add(urls[i].url, { "path": "/tmp" }, function (torrent) {
      fs.writeFile(dir + "/" + torrent.dn + ".torrent", torrent.torrentFile, function (err) {
        if (err) throw err;
        console.log(chalk.green(torrent.dn) + " saved!");
        torrent.destroy();
      });
    });
  }

  setInterval(checkProgress, 2000);

});

function checkProgress() {
  if (downloader.torrents.length) {
    console.log(downloader.torrents.length + " torrents remaining...");
  } else {
    console.log(chalk.green("Downloads complete!"));
    process.exit();
  }
}