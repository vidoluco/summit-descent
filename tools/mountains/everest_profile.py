"""Hillshade map and altitude profile of the Everest world, for docs/mountains/everest.md.

Usage: python3 tools/mountains/everest_profile.py [out.png]
Reads data/worlds/everest/world.json and the whole descent line from tools/mountains/line.mjs (node,
offline, only what is on disk). Top: hillshade of the DEM around the route, the line read by the bake,
the played stages, the OSM places. Bottom: real bed altitude along the line, the played stages, the cloud
jumps, the valley floor, and the published altitudes of the places next to the line (to compare with the
30 m DEM). Needs matplotlib and numpy (nothing is installed here).
"""
import json
import subprocess
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WID = "everest"
COLORS = ["#2f6fdf", "#16a3a0", "#e0962a", "#c8443c"]
# published altitudes (sources in docs/mountains/everest.md); DEM values are read off the line
PUBLISHED = {"Khumbu Icefall": 5486, "Gorak Shep": 5164, "Lobuche": 4940, "Thukla": 4620, "Pheriche": 4250, "Pangboche": 3930}


def hillshade(z, step, az=315.0, alt=40.0):
    gy, gx = np.gradient(z, step)  # rows go south (+z), columns east (+x)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gy, gx)
    a, h = np.radians(360.0 - az + 90.0), np.radians(alt)
    return np.clip(np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "mountains" / f"{WID}-profile.png"
    world = json.loads((ROOT / "data" / "worlds" / WID / "world.json").read_text())
    line = json.loads(subprocess.run(["node", "tools/mountains/line.mjs", WID, "--step", "30"], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    g = line["grid"]
    Z = np.array(g["data"], dtype=float).reshape(g["h"], g["w"])
    pts = line["line"]
    rk = np.array([p["rk"] for p in pts]) / 1000.0
    alt = np.array([p["alt"] for p in pts])
    lx, lz = np.array([p["x"] for p in pts]) / 1000, -np.array([p["z"] for p in pts]) / 1000
    floor_km = line["floor"]["rk"] / 1000.0

    p0 = np.radians(world["frame"]["lat"])
    mlat = 111132.954 - 559.822 * np.cos(2 * p0) + 1.175 * np.cos(4 * p0)
    mlon = 111412.84 * np.cos(p0) - 93.5 * np.cos(3 * p0)
    to_km = lambda lon, lat: ((lon - world["frame"]["lon"]) * mlon / 1000, (lat - world["frame"]["lat"]) * mlat / 1000)  # noqa: E731

    fig = plt.figure(figsize=(11, 12), dpi=110)
    ax = fig.add_axes([0.08, 0.40, 0.86, 0.56])
    ext = [g["x0"] / 1000, (g["x0"] + (g["w"] - 1) * g["step"]) / 1000, -(g["z0"] + (g["h"] - 1) * g["step"]) / 1000, -g["z0"] / 1000]
    ax.imshow(Z, extent=ext, cmap="terrain", vmin=Z.min() - 1500, vmax=Z.max() + 200, interpolation="bilinear")
    ax.imshow(hillshade(Z, g["step"]), extent=ext, cmap="gray", alpha=0.55, interpolation="bilinear")
    cs = ax.contour(np.linspace(ext[0], ext[1], g["w"]), np.linspace(ext[3], ext[2], g["h"]), Z, levels=np.arange(4000, 8801, 500), colors="k", linewidths=0.35, alpha=0.5)
    ax.clabel(cs, fmt="%d", fontsize=6, inline=True)
    played = rk <= floor_km
    ax.plot(lx[played], lz[played], color="white", lw=4.0, alpha=0.9, solid_capstyle="round")
    ax.plot(lx, lz, color="#222", lw=1.2, ls="--", alpha=0.85, label="line read by the bake (DEM, through via points)")
    for k, s in enumerate(world["stages"]):
        cx = (np.array([p["x"] for p in s["course"]]) + s["offset"]["x"]) / 1000
        cz = -(np.array([p["z"] for p in s["course"]]) + s["offset"]["z"]) / 1000
        ax.plot(cx, cz, color=COLORS[k], lw=3.4, label=f"stage {k + 1}: {s['labels']['en']} ({s['altitude'][1]}-{s['altitude'][0]} m)")
        ax.plot(cx[-1], cz[-1], "o", color=COLORS[k], ms=5, mec="white")
    ax.plot(0, 0, "^", color="k", ms=10, mec="white")
    ax.annotate(f"Mount Everest 8849 m (DEM {line['summit']['h']:.0f} m)", (0, 0), xytext=(8, -4), textcoords="offset points", fontsize=8, weight="bold")
    for p in world["places"][1:]:
        x, y = to_km(p["lon"], p["lat"])
        if ext[0] < x < ext[1] and ext[2] < y < ext[3] and p["name"] != "The Balcony":
            ax.plot(x, y, "s", color="k", ms=3.5)
            ax.annotate(p["name"], (x, y), xytext=(4, 3), textcoords="offset points", fontsize=7)
    fx, fy = lx[np.argmin(np.abs(rk - floor_km))], lz[np.argmin(np.abs(rk - floor_km))]
    ax.plot(fx, fy, "X", color="k", ms=8, mec="white")
    ax.annotate("valley floor", (fx, fy), xytext=(6, -10), textcoords="offset points", fontsize=7, style="italic")
    ax.set_xlim(ext[0], ext[1])
    ax.set_ylim(ext[2], ext[3])
    ax.set_aspect("equal")
    ax.set_xlabel("km east of the summit")
    ax.set_ylabel("km north of the summit")
    ax.set_title("Everest, Nepal side: course at 1:1 on Copernicus GLO-30 (hillshade, 500 m contours)", fontsize=10)
    ax.legend(loc="upper left", fontsize=7, framealpha=0.85)

    bx = fig.add_axes([0.08, 0.06, 0.86, 0.28])
    bx.fill_between(rk, alt, 3700, color="#d9d4c7")
    bx.plot(rk, alt, color="#555", lw=1)
    for k, s in enumerate(world["stages"]):
        m = (rk >= s["realKm"][0]) & (rk <= s["realKm"][1])
        slope = (s["altitude"][1] - s["altitude"][0]) / s["length"] * 100
        bx.plot(rk[m], alt[m], color=COLORS[k], lw=4)
        bx.annotate(f"{k + 1}  {s['labels']['en']}\n{s['length']} m, {s['altitude'][1]}-{s['altitude'][0]} m, {slope:.0f} %", (s["realKm"][0], s["altitude"][1]), xytext=(10, 2 if k < len(world["stages"]) - 1 else 26), textcoords="offset points", fontsize=7, color=COLORS[k], weight="bold")
        if k:
            a = world["stages"][k - 1]
            bx.annotate("", (s["realKm"][0], s["altitude"][1]), xytext=(a["realKm"][1], a["altitude"][0]), arrowprops=dict(arrowstyle="->", ls=":", color="#3a7bd5", lw=1, connectionstyle="arc3,rad=-0.25"))
    bx.axvline(floor_km, color="k", ls="--", lw=0.8)
    bx.annotate(f"valley floor {line['floor']['alt']:.0f} m\n(slope < {world['floor']['slope'] * 100:.0f} % over {world['floor']['window'] / 1000:.0f} km)", (floor_km, 3750), xytext=(4, 8), textcoords="offset points", fontsize=7)
    for p in world["places"][1:]:
        if p["name"] in PUBLISHED and rk.min() <= p["riverKm"] <= rk.max():
            y = float(np.interp(p["riverKm"], rk, alt))
            bx.plot(p["riverKm"], y, "s", color="k", ms=3)
            bx.plot(p["riverKm"], PUBLISHED[p["name"]], "_", color="#b0302a", ms=10, mew=1.5)
            bx.annotate(f"{p['name']}\n{PUBLISHED[p['name']]} m", (p["riverKm"], max(y, PUBLISHED[p["name"]])), xytext=(3, 6), textcoords="offset points", fontsize=6.5)
    bx.plot([], [], "_", color="#b0302a", ms=10, mew=1.5, label="published altitude")
    bx.plot([], [], "s", color="k", ms=3, label="DEM bed under the place")
    bx.legend(loc="upper right", fontsize=7)
    bx.set_xlim(rk.min(), rk.max())
    bx.set_ylim(3700, 9100)
    bx.set_xlabel("km along the line from the summit")
    bx.set_ylabel("real bed altitude (m)")
    bx.set_title("Profile: played stages in colour, dotted arrows are the cloud jumps", fontsize=10)
    bx.grid(alpha=0.3)
    fig.text(0.08, 0.012, "Data: Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and Airbus 2014-2018, provided under COPERNICUS by the EU and ESA; glaciers and places (c) OpenStreetMap contributors, ODbL", fontsize=6.5, color="#555")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    print(out)


if __name__ == "__main__":
    main()
