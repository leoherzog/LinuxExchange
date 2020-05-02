var node;
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
    let option = document.createElement("option");
    option.text = distro['name'];
    os.add(option);
  }
  os.selectedIndex = distros['recommended-distro-index'];

  onDistroChange();
  os.addEventListener('change', onDistroChange);
  onVersionChange();
  version.addEventListener('change', onVersionChange);
  start.addEventListener('click', download);

  try {
    updateNodeStatus('loading', 'Turning this browser tab into an IPFS node...');
    await startNode();
    setInterval(() => node.swarm.peers().then(peers => console.log("Peers: " + peers.length)), 15000);
  }
  catch(e) {
    updateNodeStatus('error', 'Problem starting node. ' + e.toString());
    setTimeout(load, 15000);
  }

}

function onDistroChange() {

  selectedDistro = distros.distros.find(index => index['name'] == os.value);

  // boolean on whether this distro has only one unique attribute
  let hasSameVersion = selectedDistro.versions.every((element, index, array) => element['version'] == array[0]['version']);
  let hasSameDE = selectedDistro.versions.every((element, index, array) => element['desktop-environment'] == array[0]['desktop-environment']);
  let hasSameArch = selectedDistro.versions.every((element, index, array) => element['arch'] == array[0]['arch']);

  version.innerHTML = '';
  for (let version of selectedDistro.versions) {
    let properties = [];
    if (!hasSameVersion) properties.push(version['version']);
    if (!hasSameDE) properties.push(version['desktop-environment']);
    if (!hasSameArch) properties.push(version['arch']);
    let option = document.createElement('option');
    option.text = properties.join(' — ') || version['version'];
    if (version['ipfs-hash']) {
      option.value = version['ipfs-hash'];
    } else {
      option.disabled = true;
      option.text += ' (temporarily unavailable)'
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
  selectedVersion = selectedDistro.versions.find(index => index['ipfs-hash'] == version.value);

  if (!selectedVersion) {
    versionNumber.innerHTML = "";
    desktopEnvironment.innerHTML = "";
    arch.innerHTML = "";
    start.disabled = true;
    return;
  }

  let selectedDesktopEnvironment = distros['desktop-environments'][selectedVersion['desktop-environment']];
  
  versionNumber.innerHTML = selectedDistro['full-name'] + " " + selectedVersion['version'];
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

async function startNode(event) {
  console.log("Starting IPFS...");
  if (window.ipfs && window.ipfs.enable) {
    node = await window.ipfs.enable();
  } else {
    node = await Ipfs.create();
  }
  let ipfsVersion = await node.version();
  console.log("Started, version " + ipfsVersion.version);
  updateNodeStatus('ready', 'This browser tab is a v' + ipfsVersion.version + ' node connected to the IPFS network');
}

async function download() {

  let hash = selectedVersion['ipfs-hash'];
  let name = selectedVersion['direct-download-url'].substring(selectedVersion['direct-download-url'].lastIndexOf('/') + 1);
  let total = selectedVersion['file-size'];

  let row = document.getElementById(hash);
  if (!row) {
    console.log("Starting download for " + name);
    row = createRow(hash);
    downloads.appendChild(row);
  } else {
    console.error("Already downloading " + name);
  }

  let progressStatus = document.getElementById(hash + '-progress');

  for await (const file of node.get(hash)) {

    var content = new Blob([], {"type": "application/octet-stream"});
    let progress = 0;
    for await (const chunk of file.content) {
      if (!progress) document.getElementById(hash + '-total').innerHTML = ' / ' + filesize(total) + ' <span class="fad fa-spinner fa-fw fa-pulse"></span>';
      progress += chunk.byteLength;
      content = new Blob([content, chunk], {"type": "application/octet-stream"});
      let digits = new Number(progress > 1073741824);
      progressStatus.innerHTML = filesize(progress, {"round": digits});
    }

    console.log("Saving " + name);
    
    var a = document.createElement('a');
    var url = window.URL.createObjectURL(content);
    a.setAttribute("href", url);
    a.setAttribute("download", name);
    a.innerHTML = 'Save Again';
    document.getElementById(hash + '-progress').innerHTML = '';
    document.getElementById(hash + '-progress').appendChild(a);
    document.getElementById(hash + '-total').innerHTML = '(' + filesize(total) + ') <span class="far fa-file-check fa-fw ready"></span>';
    a.click();
    console.log("Saved " + name);

  };

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
  col1.innerHTML = '<span style="color:' + selectedDistro['primary-color'] + '" class="' + (selectedDistro['font-logos-icon'] || 'fab fa-linux') +'"></span>';
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

function updateNodeStatus(status, message) {
  nodeStatusIcon.className = status;
  nodeStatusText.className = status;
  switch (status) {
    case "loading":
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="fas fa-spinner fa-pulse fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'about to be connected directly to the IPFS network';
      start.disabled = true;
      break;
    case "ready":
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="far fa-chart-network fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'currently connected directly to the IPFS network';
      start.disabled = false;
      break;
    case "error":
      nodeStatusIcon.innerHTML = '<span class="fa-stack"><span class="fas fa-circle fa-stack-2x"></span><span class="fas fa-exclamation fa-stack-1x fa-inverse"></span></span>';
      nodeStatusIcon.setAttribute('title', message);
      nodeStatusText.innerText = 'capable of being connected to the IPFS network, but we ran into a snag (' + message + ')';
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
      color = + ("0x" + color.slice(1).replace(color.length < 5 && /./g, '$&$&'));
      r = color >> 16;
      g = color >> 8 & 255;
      b = color & 255;
  }
  hsp = Math.sqrt(0.299 * (r * r) + 0.587 * (g * g) + 0.114 * (b * b));
  return hsp < 127.5;
}