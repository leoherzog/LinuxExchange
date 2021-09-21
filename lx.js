var client;
var distros;
var selectedDistro;
var selectedVersion;
var header = document.getElementById('header');
var source = document.getElementById('source');
var os = document.getElementById('os');
var version = document.getElementById('version');
var start = document.getElementById('start');
var versionNumber = document.getElementById('version-number');
var desktopEnvironment = document.getElementById('desktop-environment');
var arch = document.getElementById('arch');
var nodeStatusIcon = document.getElementById('nodeStatusIcon');
var nodeStatusText = document.getElementById('nodeStatusText');
var downloads = document.getElementById('downloads');

window.onload = load;

async function load() {

  updateNodeStatus('loading', 'Fetching info about Distros...');

  try {
    let res = await fetch('distros.json');
    distros = await res.json();
  }
  catch(e) {
    updateNodeStatus('error', 'Problem loading Distros information. ' + e.toString());
    console.error(e.toString());
    setTimeout(load, 10000);
    return;
  }

  os.innerHTML = '';
  for (let distro of distros.distros) {
    let option = document.createElement('option');
    option.text = distro['name'];
    if (distro.versions.every(version => version['magnet-url'] === null)) {
      option.text += ' (torrents unavailable)';
      option.disabled = true;
    }
    os.add(option);
  }
  os.selectedIndex = distros['recommended-distro-index'];

  onDistroChange();
  os.addEventListener('change', onDistroChange);
  onVersionChange();
  version.addEventListener('change', onVersionChange);
  start.addEventListener('click', download);

  try {
    updateNodeStatus('loading', 'Turning this browser tab into a Torrent client...');
    client = new WebTorrent();
    setTimeout(checkStatus, 1000);
    setInterval(checkStatus, 5000);
  }
  catch(e) {
    updateNodeStatus('error', 'Problem starting node. ' + e.toString());
    setTimeout(load, 15000);
  }

}

function onDistroChange() {

  selectedDistro = distros.distros.find(index => index['name'] == os.value);

  // boolean on whether this distro has only one unique attribute
  let hasSameVersion = selectedDistro.versions.every((version, index, versions) => version['version'] == versions[0]['version']);
  let hasSameDE = selectedDistro.versions.every((version, index, versions) => version['desktop-environment'] == versions[0]['desktop-environment']);
  let hasSameArch = selectedDistro.versions.every((version, index, versions) => version['arch'] == versions[0]['arch']);

  version.innerHTML = '';
  for (let version of selectedDistro.versions) {
    let properties = [];
    if (!hasSameVersion) properties.push(version['version']);
    if (!hasSameDE) properties.push(version['desktop-environment']);
    if (!hasSameArch) properties.push(version['arch']);
    let option = document.createElement('option');
    option.text = properties.join(' — ') || version['version'];
    if (version['magnet-url']) {
      option.value = version['magnet-url'].split('btih:')[1].split('&')[0];
    } else {
      option.disabled = true;
      option.text += ' (temporarily unavailable)';
    }
    document.getElementById('version').add(option);
  }

  version.disabled = selectedDistro.versions.length == 1;

  version.selectedIndex = selectedDistro['recommended-version-index'];

  let textColor = isDark(selectedDistro['primary-color']) ? '#fff' : '#0D191F';
  header.setAttribute('style', 'color: ' + textColor + ';background:' + selectedDistro['primary-color']);
  source.setAttribute('style', 'color: ' + textColor + ';');

  onVersionChange();

}

function onVersionChange() {
  
  selectedDistro = distros.distros.find(index => index['name'] == os.value);
  selectedVersion = selectedDistro.versions.find(index => index['magnet-url'] && index['magnet-url'].split('btih:')[1].split('&')[0] == version.value);

  if (!selectedVersion) {
    versionNumber.innerHTML = '';
    desktopEnvironment.innerHTML = '';
    arch.innerHTML = '';
    start.disabled = true;
    return;
  }

  let selectedDesktopEnvironment = distros['desktop-environments'][selectedVersion['desktop-environment']];
  
  versionNumber.innerHTML = selectedDistro['full-name'] + ' ' + selectedVersion['version'];
  if (selectedDistro['font-logos-icon']) {
    versionNumber.innerHTML = '<span class="' + selectedDistro['font-logos-icon'] +'"></span> ' + versionNumber.innerHTML;
  }
  versionNumber.setAttribute('title', selectedDistro['description']);
  if (selectedDistro['url']) {
    versionNumber.setAttribute('onclick', 'window.open("' + selectedDistro['url'] + '", "_blank")');
  } else {
    versionNumber.setAttribute('onclick', '');
  }

  desktopEnvironment.innerHTML = selectedVersion['desktop-environment'];
  desktopEnvironment.setAttribute('title', selectedDesktopEnvironment['description']);
  if (selectedDesktopEnvironment['url']) {
    desktopEnvironment.setAttribute('onclick', 'window.open("' + selectedDesktopEnvironment['url'] + '", "_blank")');
  } else {
    desktopEnvironment.setAttribute('onclick', '');
  }

  arch.innerHTML = selectedVersion['arch'];
  arch.setAttribute('title', distros['architectures'][selectedVersion['arch']]);

  start.disabled = false;

}

async function download() {

  let hash = selectedVersion['magnet-url'].split('btih:')[1].split('&')[0];
  let name = selectedVersion['direct-download-url'].substring(selectedVersion['direct-download-url'].lastIndexOf('/') + 1);
  let total = selectedVersion['file-size'];

  let row = document.getElementById(hash);
  if (!row) {
    console.log('Starting download for ' + name);
    row = createRow(hash);
    downloads.appendChild(row);
  } else {
    console.error('Already downloading ' + name);
  }

  let progressStatus = document.getElementById(hash + '-progress');
  let progressTotal = document.getElementById(hash + '-total');

  let id = selectedVersion['magnet-url'];
  if (selectedDistro.trackers.length) id += '&tr=' + selectedDistro.trackers.join('&tr=');
  id += '&tr=' + distros.trackers.join('&tr=');
  try {
    let res = await fetch('https://newtrackon.com/api/stable');
    if (res.status != 200) throw new Error('Failed to fetch additional trackers');
    let additionalTrackers = await res.text();
    additionalTrackers = additionalTrackers.split('\n').filter(tracker => !!tracker);
    id += '&tr=' + additionalTrackers.join('&tr=');
  }
  catch(e) {
    console.error('Trouble fetching more trackers from newTrackon: ' + e);
  }

  id += '&ws=' + selectedVersion['direct-download-url'].replace('{{base64time}}', btoa(new Date().getTime().toString()));
  
  console.info('Downloading ' + name);
  console.info(id);

  client.add(id, {"store": window.IdbChunkStore}, function(torrent) {
    progressTotal.innerHTML = ' / ' + filesize(total) + ' <span class="fad fa-spinner fa-fw fa-pulse"></span>';
    progressStatus.innerHTML = filesize(0);
    torrent.on('download', () => {
      let digits = new Number(torrent.downloaded > 1073741824);
      progressStatus.innerHTML = filesize(torrent.downloaded, {"round": digits});
    });
    torrent.on('done', () => {
      console.log(torrent.name + ' done!');
      torrent.files.forEach((file) => {
        progressStatus.innerHTML = '';
        progressTotal.innerHTML = 'Assembling... <span class="fad fa-spinner fa-fw fa-pulse"></span>';
        file.getBlobURL((err, url) => {
          if (err) throw err;
          progressTotal.innerHTML = '';
          var a = document.createElement('a');
          a.download = file.name;
          a.href = url;
          a.innerHTML = '<span class="far fa-file-download fa-fw ready"></span> Save ' + file.name;
          progressStatus.appendChild(a);
        });
      });
    });
  });

}

function createRow(hash) {

  row = document.createElement('div');
  row.setAttribute('id', hash);
  row.className = 'row';

  let left = document.createElement('div');
  let right = document.createElement('div');

  let col1 = document.createElement('div');
  col1.setAttribute('id', hash + '-distroicon');
  col1.className = 'cell';
  col1.innerHTML = '<span style="color:' + selectedDistro['primary-color'] + '" class="' + (selectedDistro['font-logos-icon'] || 'fas fa-compact-disc') +'"></span>';
  left.appendChild(col1);
  
  let col2 = document.createElement('div');
  col2.setAttribute('id', hash + '-name');
  col2.className = 'cell';
  col2.innerHTML = selectedDistro['full-name'] + ' ' + selectedVersion['version'] + ' (' + selectedVersion['desktop-environment'] + ', ' + selectedVersion['arch'] + ')';
  left.appendChild(col2);
  
  let col3 = document.createElement('div');
  col3.setAttribute('id', hash + '-progress');
  col3.className = 'cell';
  col3.innerHTML = 'Requesting...';
  right.appendChild(col3);
  
  let col4 = document.createElement('div');
  col4.setAttribute('id', hash + '-total');
  col4.className = 'cell';
  col4.innerHTML = filesize(selectedVersion['file-size']) + ' <span class="fad fa-users fa-fw blink"></span>';
  right.appendChild(col4);

  row.appendChild(left);
  row.appendChild(right);
  
  return row;

}

function checkStatus() {
  console.info('Client ready: ' + client.ready + ', Torrents: ' + client.torrents.length);
  if (client.ready) {
    updateNodeStatus('ready', 'This browser tab is a node in the WebTorrent network');
  } else {
    updateNodeStatus('loading', 'This browser tab is loading a peer node in the WebTorrent network');
  }
}

function updateNodeStatus(status, message) {
  nodeStatusIcon.className = status;
  nodeStatusText.className = status;
  switch (status) {
    case 'loading':
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="fas fa-spinner fa-pulse fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'about to be connected directly to the WebTorrent network';
      start.disabled = true;
      break;
    case 'ready':
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="far fa-chart-network fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'currently connected directly to the WebTorrent network';
      start.disabled = false;
      break;
    case 'error':
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="fas fa-exclamation fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'capable of being connected to the WebTorrent network, but we ran into a snag (' + message + ')';
      start.disabled = true;
      break;
  }
}

Array.prototype.unique = function() { 
  var seen = {};
  var out = [];
  var len = this.length;
  var j = 0;
  for (var i = 0; i < len; i++) {
    var item = this[i];
    if (seen[item] !== 1) {
      seen[item] = 1;
      out[j++] = item;
    }
  }
  return out;
}

// https://awik.io/determine-color-bright-dark-using-javascript/
function isDark(color) {
  var r, g, b, hsp;
  if (color.match(/^rgb/)) {
      color = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
      r = color[1];
      g = color[2];
      b = color[3];
  } else {
      color = + ('0x' + color.slice(1).replace(color.length < 5 && /./g, '$&$&'));
      r = color >> 16;
      g = color >> 8 & 255;
      b = color & 255;
  }
  hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  return hsp < 127.5;
}
