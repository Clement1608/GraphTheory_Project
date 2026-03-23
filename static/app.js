const graphSelect = document.querySelector("#graph-select");
const stepRange = document.querySelector("#step-range");
const stepLabel = document.querySelector("#step-label");
const stepUpdates = document.querySelector("#step-updates");
const startNodeSelect = document.querySelector("#start-node");
const endNodeSelect = document.querySelector("#end-node");
const pathButton = document.querySelector("#path-button");
const pathResult = document.querySelector("#path-result");
const vertexCount = document.querySelector("#vertex-count");
const edgeCount = document.querySelector("#edge-count");
const graphTitle = document.querySelector("#graph-title");
const graphNumber = document.querySelector("#graph-number");
const circuitStatus = document.querySelector("#circuit-status");
const matrixContainer = document.querySelector("#matrix-container");
const matrixTitle = document.querySelector("#matrix-title");
const distanceMatrixButton = document.querySelector("#distance-matrix-button");
const predecessorMatrixButton = document.querySelector("#predecessor-matrix-button");
const resetLayoutButton = document.querySelector("#reset-layout-button");
const downloadTraceButton = document.querySelector("#download-trace-button");
const graphSizeMessage = document.querySelector("#graph-size-message");
const graphVisualCard = document.querySelector("#graph-visual-card");
const graphCardHeaderCopy = document.querySelector("#graph-card-header-copy");
const svg = d3.select("#graph-canvas");

let currentGraph = null;
let activeStep = 0;
let highlightedLinks = new Set();
let highlightedNodes = new Set();
let activeMatrix = "distance";
let currentSimulation = null;
let currentNodes = [];
let defaultNodePositions = new Map();
let layoutDirty = false;

const width = 900;
const height = 540;
const MAX_GRAPH_VERTICES = 50;
const EDGE_COLOR = "#4b5563";
const HIGHLIGHT_COLOR = "#0ea5e9";

async function fetchGraph(graphName) {
  const response = await fetch(`/api/graphs/${encodeURIComponent(graphName)}`);
  if (!response.ok) {
    throw new Error(`Unable to load ${graphName}`);
  }
  return response.json();
}

async function appendTrace(action, payload = {}) {
  const response = await fetch("/api/trace", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to append to execution_traces.txt");
  }
}

function populateNodeSelects(nodes) {
  const optionsMarkup = nodes
    .map((node) => `<option value="${node.id}">${node.label}</option>`)
    .join("");

  startNodeSelect.innerHTML = optionsMarkup;
  endNodeSelect.innerHTML = optionsMarkup;

  if (nodes.length > 1) {
    endNodeSelect.value = nodes[nodes.length - 1].id;
  }
}

function renderMatrix(matrix) {
  if (!matrix || matrix.length === 0) {
    matrixContainer.textContent = "No matrix available.";
    return;
  }

  const table = document.createElement("table");
  table.className = "matrix-table";

  const header = document.createElement("tr");
  header.innerHTML = `<th></th>${matrix[0]
    .map((_, index) => `<th>${index}</th>`)
    .join("")}`;
  table.appendChild(header);

  matrix.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${rowIndex}</th>${row
      .map((value) => `<td>${value}</td>`)
      .join("")}`;
    table.appendChild(tr);
  });

  matrixContainer.replaceChildren(table);
}

function downloadTrace() {
  window.location.href = "/api/trace/download";
}

function setActiveMatrix(matrixType) {
  activeMatrix = matrixType;
  distanceMatrixButton?.classList.toggle("is-active", matrixType === "distance");
  predecessorMatrixButton?.classList.toggle("is-active", matrixType === "predecessor");
  matrixTitle.textContent = matrixType === "distance" ? "Current L matrix" : "Current P matrix";

  if (currentGraph) {
    appendTrace("matrix_view", {
      graphName: currentGraph.name,
      matrixType: matrixType === "distance" ? "L" : "P",
    }).catch((error) => {
      console.error(error.message);
    });
    renderStep(activeStep);
  }
}

function edgeKey(source, target) {
  return `${source}-${target}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildComponentLayout(data) {
  const adjacency = new Map(data.nodes.map((node) => [node.id, []]));
  const degrees = new Map(data.nodes.map((node) => [node.id, 0]));

  data.links.forEach((link) => {
    adjacency.get(link.source)?.push(link.target);
    adjacency.get(link.target)?.push(link.source);
    degrees.set(link.source, (degrees.get(link.source) || 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) || 0) + 1);
  });

  const visited = new Set();
  const components = [];

  data.nodes.forEach((node) => {
    if (visited.has(node.id)) {
      return;
    }

    const queue = [node.id];
    const component = [];
    visited.add(node.id);

    while (queue.length > 0) {
      queue.sort((left, right) => {
        const degreeDelta = (degrees.get(right) || 0) - (degrees.get(left) || 0);
        return degreeDelta !== 0 ? degreeDelta : left - right;
      });

      const current = queue.shift();
      component.push(current);

      adjacency.get(current)
        .slice()
        .sort((left, right) => {
          const degreeDelta = (degrees.get(right) || 0) - (degrees.get(left) || 0);
          return degreeDelta !== 0 ? degreeDelta : left - right;
        })
        .forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
        });
    }

    components.push(component);
  });

  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)));
  const rows = Math.max(1, Math.ceil(components.length / columns));
  const componentCenters = new Map();

  components.forEach((component, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const centerX = ((column + 0.5) * width) / columns;
    const centerY = ((row + 0.5) * height) / rows;
    const sortedComponent = component
      .slice()
      .sort((left, right) => {
        const degreeDelta = (degrees.get(right) || 0) - (degrees.get(left) || 0);
        return degreeDelta !== 0 ? degreeDelta : left - right;
      });

    if (sortedComponent.length === 1) {
      componentCenters.set(sortedComponent[0], { x: centerX, y: centerY });
      return;
    }

    const ringRadius = Math.min(
      Math.max(95, sortedComponent.length * 34),
      Math.min(width / columns, height / rows) / 2 - 34,
    );
    const angleOffset = (index % 2) * (Math.PI / sortedComponent.length);

    sortedComponent.forEach((nodeId, nodeIndex) => {
      const angle = angleOffset + (2 * Math.PI * nodeIndex) / sortedComponent.length;
      componentCenters.set(nodeId, {
        x: centerX + (Math.cos(angle) * ringRadius),
        y: centerY + (Math.sin(angle) * ringRadius),
      });
    });
  });

  return componentCenters;
}

function buildEdgeMetadata(links) {
  const pairCounts = new Map();
  const directionalIndex = new Map();

  links.forEach((link) => {
    const pairKey = [link.source, link.target].sort((a, b) => a - b).join("-");
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
  });

  links.forEach((link) => {
    const directionKey = `${link.source}-${link.target}`;
    const pairKey = [link.source, link.target].sort((a, b) => a - b).join("-");
    const index = directionalIndex.get(directionKey) || 0;
    directionalIndex.set(directionKey, index + 1);

    link.parallelIndex = index;
    link.parallelCount = pairCounts.get(pairKey) || 1;
    link.isBidirectional = pairCounts.get(pairKey) > 1;
  });
}

function getEdgeGeometry(linkDatum) {
  if (linkDatum.source.id === linkDatum.target.id) {
    const loopRadius = 28 + (linkDatum.parallelIndex * 10);
    return {
      isSelfLoop: true,
      loopRadius,
      loopWidth: loopRadius + 10,
      loopHeight: loopRadius + 18,
    };
  }

  const dx = linkDatum.target.x - linkDatum.source.x;
  const dy = linkDatum.target.y - linkDatum.source.y;
  const distance = Math.sqrt((dx * dx) + (dy * dy)) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const directionSign = linkDatum.source.id < linkDatum.target.id ? 1 : -1;
  const laneOffset = linkDatum.isBidirectional ? 18 * directionSign : 0;
  const siblingOffset = linkDatum.parallelIndex * 12;
  const totalOffset = laneOffset + siblingOffset;

  return {
    isSelfLoop: false,
    dx,
    dy,
    distance,
    normalX,
    normalY,
    curveOffset: totalOffset,
  };
}

function getLabelPosition(linkDatum) {
  const geometry = getEdgeGeometry(linkDatum);

  if (geometry.isSelfLoop) {
    return {
      x: linkDatum.source.x,
      y: linkDatum.source.y - geometry.loopHeight + 2,
    };
  }

  return {
    x: (linkDatum.source.x + linkDatum.target.x) / 2 + (geometry.normalX * geometry.curveOffset),
    y: (linkDatum.source.y + linkDatum.target.y) / 2 + (geometry.normalY * geometry.curveOffset),
  };
}

function updateHighlights(path = []) {
  highlightedLinks = new Set();
  highlightedNodes = new Set(path);

  for (let i = 0; i < path.length - 1; i += 1) {
    highlightedLinks.add(edgeKey(path[i], path[i + 1]));
  }

  svg.selectAll(".edge-path")
    .style("stroke", (d) => (highlightedLinks.has(d.id) ? HIGHLIGHT_COLOR : EDGE_COLOR))
    .attr("stroke-width", (d) => (highlightedLinks.has(d.id) ? 4 : 2.2))
    .attr("marker-end", (d) => (highlightedLinks.has(d.id) ? "url(#arrowhead-highlight)" : "url(#arrowhead-default)"));

  svg.selectAll(".node-circle")
    .style("fill", (d) => (highlightedNodes.has(d.id) ? HIGHLIGHT_COLOR : "#1f2937"))
    .attr("r", (d) => (highlightedNodes.has(d.id) ? 20 : 16));
}

function setLayoutDirty(isDirty) {
  layoutDirty = isDirty;
  resetLayoutButton?.classList.toggle("is-hidden", !isDirty);
}

function setGraphDisplayState(shouldShowGraph, message = "") {
  graphVisualCard?.classList.toggle("graph-card-message-mode", !shouldShowGraph);
  graphCardHeaderCopy?.classList.toggle("is-hidden", !shouldShowGraph);
  svg.classed("is-hidden", !shouldShowGraph);
  graphSizeMessage?.classList.toggle("is-hidden", shouldShowGraph);
  if (graphSizeMessage) {
    graphSizeMessage.textContent = message;
  }
  if (!shouldShowGraph) {
    setLayoutDirty(false);
  }
}

function captureDefaultPositions(nodes) {
  defaultNodePositions = new Map(
    nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
}

function renderGraph(data) {
  if (data.vertexCount > MAX_GRAPH_VERTICES) {
    svg.selectAll("*").remove();
    currentSimulation = null;
    currentNodes = [];
    defaultNodePositions = new Map();
    setGraphDisplayState(false, "The graph is too large to be displayed on this computer.");
    return;
  }

  setGraphDisplayState(true);
  svg.selectAll("*").remove();
  setLayoutDirty(false);

  const defs = svg.append("defs");
  [
    { id: "arrowhead-default", color: EDGE_COLOR },
    { id: "arrowhead-highlight", color: HIGHLIGHT_COLOR },
  ].forEach((markerDef) => {
    defs.append("marker")
      .attr("id", markerDef.id)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", markerDef.color);
  });

  const componentCenters = buildComponentLayout(data);
  const nodes = data.nodes.map((node) => {
    const center = componentCenters.get(node.id) || { x: width / 2, y: height / 2 };
    return {
      ...node,
      x: center.x,
      y: center.y,
      fx: null,
      fy: null,
    };
  });
  currentNodes = nodes;
  captureDefaultPositions(nodes);

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(data.links.map((link) => ({ ...link }))).id((d) => d.id).distance(120).strength(0.18))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(46).strength(0.95))
    .force("x", d3.forceX((d) => componentCenters.get(d.id)?.x ?? width / 2).strength(0.55))
    .force("y", d3.forceY((d) => componentCenters.get(d.id)?.y ?? height / 2).strength(0.55));
  currentSimulation = simulation;

  const linkLayer = svg.append("g").attr("class", "links");
  const labelLayer = svg.append("g").attr("class", "labels");
  const nodeLayer = svg.append("g").attr("class", "nodes");

  const links = simulation.force("link").links();
  buildEdgeMetadata(links);

  const link = linkLayer.selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "edge-path")
    .attr("marker-end", "url(#arrowhead-default)");

  const edgeLabel = labelLayer.selectAll("g")
    .data(links)
    .join("g")
    .attr("class", "edge-label");

  edgeLabel.append("rect")
    .attr("class", "edge-label-bg")
    .attr("rx", 8)
    .attr("ry", 8);

  edgeLabel.append("text")
    .attr("class", "edge-label-text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .text((d) => d.weight);

  const node = nodeLayer.selectAll("g")
    .data(simulation.nodes())
    .join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", dragStarted(simulation))
      .on("drag", dragged)
      .on("end", dragEnded(simulation)));

  node.append("circle")
    .attr("class", "node-circle")
    .attr("r", 16);

  node.append("text")
    .attr("class", "node-label")
    .attr("dy", 5)
    .text((d) => d.label);

  simulation.on("tick", () => {
    simulation.nodes().forEach((d) => {
      d.x = clamp(d.x, 28, width - 28);
      d.y = clamp(d.y, 28, height - 28);
    });

    link.attr("d", (d) => {
      const geometry = getEdgeGeometry(d);
      if (geometry.isSelfLoop) {
        const startX = d.source.x - 6;
        const startY = d.source.y - 18;
        return [
          `M${startX},${startY}`,
          `C${d.source.x - geometry.loopWidth},${d.source.y - geometry.loopHeight}`,
          `${d.source.x + geometry.loopWidth},${d.source.y - geometry.loopHeight}`,
          `${d.source.x + 6},${startY}`,
        ].join(" ");
      }

      const midpointX = (d.source.x + d.target.x) / 2 + (geometry.normalX * geometry.curveOffset);
      const midpointY = (d.source.y + d.target.y) / 2 + (geometry.normalY * geometry.curveOffset);
      return `M${d.source.x},${d.source.y}Q${midpointX},${midpointY} ${d.target.x},${d.target.y}`;
    });

    edgeLabel
      .attr("transform", (d) => {
        const position = getLabelPosition(d);
        return `translate(${position.x},${position.y})`;
      })
      .each(function updateLabelBounds() {
        const group = d3.select(this);
        const text = group.select("text").node();
        if (!text) {
          return;
        }

        const bounds = text.getBBox();
        group.select("rect")
          .attr("x", bounds.x - 6)
          .attr("y", bounds.y - 3)
          .attr("width", bounds.width + 12)
          .attr("height", bounds.height + 6);
      });

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  updateHighlights([]);
}

function dragStarted(simulation) {
  return (event) => {
    if (!event.active) {
      simulation.alphaTarget(0.3).restart();
    }
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  };
}

function dragged(event) {
  event.subject.fx = event.x;
  event.subject.fy = event.y;
}

function dragEnded(simulation) {
  return (event) => {
    if (!event.active) {
      simulation.alphaTarget(0.05);
    }
    event.subject.fx = clamp(event.subject.x, 28, width - 28);
    event.subject.fy = clamp(event.subject.y, 28, height - 28);
    setLayoutDirty(true);
    appendTrace("move_node", {
      graphName: currentGraph.name,
      nodeId: event.subject.id,
      x: Math.round(event.subject.fx),
      y: Math.round(event.subject.fy),
    }).catch((error) => {
      console.error(error.message);
    });
  };
}

function resetLayout() {
  if (!currentSimulation || currentNodes.length === 0) {
    return;
  }

  currentNodes.forEach((node) => {
    const position = defaultNodePositions.get(node.id);
    if (!position) {
      return;
    }

    node.x = position.x;
    node.y = position.y;
    node.fx = null;
    node.fy = null;
  });

  setLayoutDirty(false);
  currentSimulation.alpha(0.9).restart();
  appendTrace("reset_layout", {
    graphName: currentGraph.name,
  }).catch((error) => {
    console.error(error.message);
  });
}

function renderStep(stepIndex) {
  activeStep = Number(stepIndex);
  const step = currentGraph.floydWarshall.steps[activeStep];
  stepLabel.textContent = step.label;

  if (step.updates.length === 0) {
    stepUpdates.textContent = "No distances improved during this step.";
  } else {
    const summary = step.updates
      .slice(0, 4)
      .map((update) => `${update.from}→${update.to} via ${update.via} = ${update.new_distance}`)
      .join(" | ");
    const suffix = step.updates.length > 4 ? ` | +${step.updates.length - 4} more` : "";
    stepUpdates.textContent = summary + suffix;
  }

  renderMatrix(activeMatrix === "distance" ? step.distanceMatrix : step.predecessorMatrix);
}

function showPath() {
  const start = startNodeSelect.value;
  const end = endNodeSelect.value;

  if (start === end) {
    pathResult.textContent = "Choose two different vertices.";
    updateHighlights([]);
    return;
  }

  if (currentGraph.floydWarshall.hasAbsorbingCircuit) {
    pathResult.textContent = "Shortest paths are not displayed because the graph contains an absorbing circuit.";
    updateHighlights([]);
    return;
  }

  const result = currentGraph.floydWarshall.shortestPaths[`${start}-${end}`];
  if (!result) {
    pathResult.textContent = `No path found from ${start} to ${end}.`;
    updateHighlights([]);
    return;
  }

  pathResult.textContent = `Distance ${result.distance} | Path ${result.path.join(" → ")}`;
  updateHighlights(result.path);
  appendTrace("highlight_path", {
    graphName: currentGraph.name,
    start: Number(start),
    end: Number(end),
  }).catch((error) => {
    console.error(error.message);
  });
}

async function loadGraph(graphName) {
  currentGraph = await fetchGraph(graphName);
  graphTitle.textContent = currentGraph.name;
  graphNumber.textContent = currentGraph.graphNumber === null
    ? "Graph number unavailable."
    : `Graph number: ${currentGraph.graphNumber}`;
  vertexCount.textContent = currentGraph.vertexCount;
  edgeCount.textContent = currentGraph.edgeCount;
  populateNodeSelects(currentGraph.nodes);
  renderGraph(currentGraph);

  circuitStatus.textContent = currentGraph.floydWarshall.hasAbsorbingCircuit
    ? "Absorbing circuit detected. Minimum-value paths are not well-defined."
    : "No absorbing circuit detected.";
  pathButton.disabled = currentGraph.floydWarshall.hasAbsorbingCircuit;

  stepRange.max = currentGraph.floydWarshall.steps.length - 1;
  stepRange.value = 0;
  renderStep(0);

  pathResult.textContent = currentGraph.floydWarshall.hasAbsorbingCircuit
    ? "Shortest-path queries are disabled for graphs with an absorbing circuit."
    : "Select two vertices to highlight their shortest path.";
  appendTrace("load_graph", { graphName: currentGraph.name }).catch((error) => {
    console.error(error.message);
  });
}

graphSelect?.addEventListener("change", async (event) => {
  await loadGraph(event.target.value);
});

stepRange?.addEventListener("input", (event) => {
  const step = Number(event.target.value);
  const stepData = currentGraph?.floydWarshall.steps[step];
  if (stepData) {
    appendTrace("step_change", {
      graphName: currentGraph.name,
      step,
      label: stepData.label,
    }).catch((error) => {
      console.error(error.message);
    });
  }
  renderStep(event.target.value);
});

pathButton?.addEventListener("click", () => {
  showPath();
});

distanceMatrixButton?.addEventListener("click", () => {
  setActiveMatrix("distance");
});

predecessorMatrixButton?.addEventListener("click", () => {
  setActiveMatrix("predecessor");
});

resetLayoutButton?.addEventListener("click", () => {
  resetLayout();
});

downloadTraceButton?.addEventListener("click", () => {
  downloadTrace();
});

const initialGraph = document.body.dataset.initialGraph;
if (initialGraph) {
  loadGraph(initialGraph).catch((error) => {
    stepLabel.textContent = error.message;
  });
} else {
  stepLabel.textContent = "No graph files were found in the Graphs directory.";
}
