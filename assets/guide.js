(function () {
  "use strict";

  var legend = '<div class="legend" aria-label="Diagram color legend"><span><i class="l-input"></i>Input</span><span><i class="l-param"></i>Learned parameter</span><span><i class="l-op"></i>Core operation</span><span><i class="l-route"></i>Route / normalize</span><span><i class="l-risk"></i>Constraint / risk</span><span><i class="l-output"></i>Output</span></div>';

  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      flowchart: { htmlLabels: true, curve: "stepAfter", nodeSpacing: 34, rankSpacing: 56, useMaxWidth: true },
      themeVariables: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "16px",
        primaryColor: "#ffffff",
        primaryTextColor: "#17211c",
        primaryBorderColor: "#789085",
        lineColor: "#176b52",
        secondaryColor: "#dcece5",
        tertiaryColor: "#f6ead2",
        clusterBkg: "#edf2ee",
        clusterBorder: "#9aaca1"
      },
      themeCSS: ".edgePath .path{stroke-width:3px!important}.arrowheadPath{fill:#176b52!important;stroke:#176b52!important}.edgeLabel{background-color:#f8faf8!important;color:#5c2e24!important}.cluster-label span{font-weight:800!important;color:#20352a!important}.nodeLabel{line-height:1.4!important}"
    });
  }

  document.querySelectorAll(".diagram .mermaid").forEach(function (node) {
    if (!node.nextElementSibling || !node.nextElementSibling.classList.contains("legend")) {
      node.insertAdjacentHTML("afterend", legend);
    }
  });

  function renderDiagrams(scopes) {
    if (!window.mermaid) return Promise.resolve();
    var roots = Array.isArray(scopes) ? scopes : [scopes];
    var nodes = roots.reduce(function (all, scope) {
      return all.concat(Array.prototype.slice.call(scope.querySelectorAll(".mermaid:not([data-processed])")));
    }, []);
    if (nodes.length) return window.mermaid.run({ nodes: nodes });
    return Promise.resolve();
  }

  var buttons = Array.prototype.slice.call(document.querySelectorAll(".tab-btn"));
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var select = document.querySelector(".mobile-nav");
  var crumb = document.getElementById("crumb");
  var guideTitle = document.body.getAttribute("data-guide-title") || document.title;

  function panelIdsFor(button) {
    return (button.dataset.panels || button.dataset.tab)
      .split(",")
      .map(function (id) { return id.trim(); })
      .filter(Boolean);
  }

  function buttonForId(id) {
    return buttons.find(function (button) {
      return button.dataset.tab === id || panelIdsFor(button).indexOf(id) !== -1;
    });
  }

  function labelFor(button) {
    return button.textContent.trim().replace(/^\d+\s*/, "");
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () { activate(button.dataset.tab, true); });
  });

  if (select && buttons.length) {
    buttons.forEach(function (button) {
      var option = document.createElement("option");
      option.value = button.dataset.tab;
      option.textContent = labelFor(button);
      select.appendChild(option);
    });
    select.addEventListener("change", function () { activate(select.value, true); });
  }

  function activate(id, push) {
    var requested = document.getElementById(id);
    var selected = buttonForId(id) || buttons[0];
    if (!selected) return;
    var panelIds = panelIdsFor(selected);
    var activeTabs = tabs.filter(function (tab) { return panelIds.indexOf(tab.id) !== -1; });
    if (!activeTabs.length) return;

    buttons.forEach(function (button) {
      var isActive = button === selected;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
    tabs.forEach(function (tab) {
      tab.classList.remove("active", "group-member", "group-start", "group-end");
      tab.setAttribute("aria-hidden", "true");
    });
    activeTabs.forEach(function (tab, index) {
      tab.classList.add("active");
      tab.setAttribute("aria-hidden", "false");
      if (activeTabs.length > 1) {
        tab.classList.add("group-member");
        if (index === 0) tab.classList.add("group-start");
        if (index === activeTabs.length - 1) tab.classList.add("group-end");
      }
    });

    if (select) select.value = selected.dataset.tab;
    var label = labelFor(selected);
    if (crumb) crumb.textContent = guideTitle + " / " + label;
    document.title = label + " · " + guideTitle;
    if (push) history.replaceState(null, "", "#" + selected.dataset.tab);

    var diagramPromise = renderDiagrams(activeTabs);
    var mathPromise = window.MathJax && window.MathJax.typesetPromise
      ? window.MathJax.typesetPromise(activeTabs)
      : Promise.resolve();
    var shouldDeepLink = !push && requested && requested.id !== selected.dataset.tab;

    if (!shouldDeepLink) window.scrollTo({ top: 0, behavior: "instant" });
    Promise.all([diagramPromise, mathPromise]).then(function () {
      if (!shouldDeepLink) return;
      window.setTimeout(function () {
        var top = requested.getBoundingClientRect().top + window.scrollY - 55;
        window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      }, 80);
    });
  }

  document.querySelectorAll("[data-answer]").forEach(function (button) {
    button.addEventListener("click", function () {
      var answer = document.getElementById(button.dataset.answer);
      if (!answer) return;
      answer.classList.toggle("show");
      button.textContent = answer.classList.contains("show") ? "Hide answer" : "Reveal answer";
    });
  });

  document.querySelectorAll("[data-choice-group]").forEach(function (group) {
    var choices = Array.prototype.slice.call(group.querySelectorAll("[data-choice]"));
    var panels = Array.prototype.slice.call(group.querySelectorAll("[data-choice-panel]"));
    choices.forEach(function (choice) {
      choice.addEventListener("click", function () {
        choices.forEach(function (item) { item.classList.toggle("active", item === choice); });
        panels.forEach(function (panel) { panel.classList.toggle("active", panel.dataset.choicePanel === choice.dataset.choice); });
      });
    });
  });

  document.querySelectorAll("[data-attention-demo]").forEach(function (demo) {
    var base = [0.5, 1.2, 2.0, 0.8];
    var labels = ["skip", "click", "long view", "share"];
    var bars = demo.querySelector(".bar-list");
    var note = demo.querySelector("[data-attention-note]");
    function draw(mode) {
      var values;
      if (mode === "softmax") {
        var exps = base.map(Math.exp);
        var sum = exps.reduce(function (a, b) { return a + b; }, 0);
        values = exps.map(function (value) { return value / sum; });
        note.textContent = "Softmax forces the weights to sum to 1. Repeating a strong signal redistributes a fixed attention budget.";
      } else {
        values = base.map(function (value) { return value / (1 + Math.exp(-value)); });
        note.textContent = "Pointwise SiLU keeps absolute magnitude. More or stronger matching events can produce a larger pooled signal before LayerNorm.";
      }
      bars.innerHTML = "";
      values.forEach(function (value, index) {
        var row = document.createElement("div");
        row.className = "bar-row";
        var width = mode === "softmax" ? value * 100 : value / 2 * 100;
        row.innerHTML = "<span>" + labels[index] + "</span><span class=\"bar-track\"><span class=\"bar-fill\" style=\"width:" + Math.min(100, width).toFixed(1) + "%\"></span></span><b>" + value.toFixed(2) + "</b>";
        bars.appendChild(row);
      });
    }
    demo.querySelectorAll("[data-attention-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        demo.querySelectorAll("[data-attention-mode]").forEach(function (item) { item.classList.toggle("active", item === button); });
        draw(button.dataset.attentionMode);
      });
    });
    draw("pointwise");
  });

  document.querySelectorAll("[data-ppo-demo]").forEach(function (demo) {
    var range = demo.querySelector("input[type=range]");
    var sign = demo.querySelector("select");
    var raw = demo.querySelector("[data-raw]");
    var clipped = demo.querySelector("[data-clipped]");
    var objective = demo.querySelector("[data-objective]");
    var status = demo.querySelector("[data-status]");
    var dot = demo.querySelector(".plot-dot");
    var rawPath = demo.querySelector("[data-plot-raw]");
    var objectivePath = demo.querySelector("[data-plot-objective]");
    function plotX(ratio) { return 35 + ratio * 160; }
    function plotY(value) { return Math.max(20, Math.min(245, 130 - value * 55)); }
    function pathFor(fn) {
      var points = [];
      for (var i = 0; i <= 40; i += 1) {
        var ratio = i / 20;
        points.push((i ? "L" : "M") + plotX(ratio).toFixed(1) + " " + plotY(fn(ratio)).toFixed(1));
      }
      return points.join(" ");
    }
    function update() {
      var ratio = Number(range.value);
      var advantage = Number(sign.value);
      var clippedRatio = Math.max(.8, Math.min(1.2, ratio));
      var rawValue = ratio * advantage;
      var clippedValue = clippedRatio * advantage;
      var objectiveValue = Math.min(rawValue, clippedValue);
      raw.textContent = rawValue.toFixed(2);
      clipped.textContent = clippedValue.toFixed(2);
      objective.textContent = objectiveValue.toFixed(2);
      status.textContent = rawValue === objectiveValue ? "Gradient still has incentive here." : "Improving move is clipped here.";
      var x = plotX(ratio);
      var y = plotY(objectiveValue);
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y.toFixed(1));
      if (rawPath) rawPath.setAttribute("d", pathFor(function (value) { return value * advantage; }));
      if (objectivePath) objectivePath.setAttribute("d", pathFor(function (value) {
        var clippedValueAtRatio = Math.max(.8, Math.min(1.2, value)) * advantage;
        return Math.min(value * advantage, clippedValueAtRatio);
      }));
      demo.querySelector("[data-ratio]").textContent = ratio.toFixed(2);
    }
    range.addEventListener("input", update);
    sign.addEventListener("change", update);
    update();
  });

  document.querySelectorAll("[data-grpo-demo]").forEach(function (demo) {
    var container = demo.querySelector(".group-samples");
    var summary = demo.querySelector("[data-group-summary]");
    function draw(rawRewards) {
      var rewards = rawRewards.split(",").map(Number);
      var mean = rewards.reduce(function (a, b) { return a + b; }, 0) / rewards.length;
      var variance = rewards.reduce(function (sum, value) { return sum + Math.pow(value - mean, 2); }, 0) / rewards.length;
      var std = Math.sqrt(variance);
      container.innerHTML = "";
      rewards.forEach(function (reward, index) {
        var advantage = std === 0 ? 0 : (reward - mean) / std;
        var card = document.createElement("div");
        card.className = "sample";
        card.innerHTML = "<strong>Output " + (index + 1) + "</strong><span class=\"reward\">" + reward.toFixed(1) + "</span><span class=\"advantage\">A = " + advantage.toFixed(2) + "</span>";
        container.appendChild(card);
      });
      summary.textContent = std === 0 ? "All rewards are equal, so every relative advantage is 0: this group supplies no policy-gradient signal." : "Group mean = " + mean.toFixed(2) + ", standard deviation = " + std.toFixed(2) + ". Better-than-group outputs are reinforced; worse ones are suppressed.";
    }
    demo.querySelectorAll("[data-rewards]").forEach(function (button) {
      button.addEventListener("click", function () {
        demo.querySelectorAll("[data-rewards]").forEach(function (item) { item.classList.toggle("active", item === button); });
        draw(button.dataset.rewards);
      });
    });
    var first = demo.querySelector("[data-rewards]");
    if (first) draw(first.dataset.rewards);
  });

  window.addEventListener("hashchange", function () { activate(location.hash.slice(1), false); });
  if (buttons.length) activate(location.hash.slice(1) || buttons[0].dataset.tab, false);
})();
