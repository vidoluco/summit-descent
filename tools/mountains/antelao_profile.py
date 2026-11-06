"""Hillshade map and altitude profile of the Antelao world (Val d'Oten), for docs/mountains/antelao.md.

Usage: python3 tools/mountains/antelao_profile.py [out.png]
Reads data/worlds/antelao/world.json, the OSM glacier outlines in data/raw/osm/antelao/glaciers.json and the
whole descent line from tools/mountains/line.mjs (node, offline, only what is on disk). Top: hillshade of the
DEM around the route, the two Antelao glaciers, the line read by the bake, the played stages and the named
points of the valley. Bottom: real bed altitude along the line, the played stages, the cloud jumps, the valley
floor, and the published altitudes of the named points next to the line (to compare with the 30 m DEM).
Needs matplotlib and numpy (nothing is installed here).
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
COLORS = ["#2f6fdf", "#16a3a0", "#e0962a", "#c8443c", "#7b5bd6"]
# Named points of the valley with their published altitude (docs/mountains/antelao.md, "Sources");
# OSM positions. None: no published altitude, the DEM value is shown.
POINTS = [
    ("Rifugio Galassi", 46.4707, 12.2619, 2018),
    ("Cascata delle Pile", 46.4799, 12.2859, 1450),
    ("Capanna degli Alpini", 46.4806, 12.2899, 1395),
    ("Praciadelan", 46.4722, 12.3383, 1044),
    ("Rizzios", 46.4556, 12.3768, None),
    ("Calalzo di Cadore", 46.4467, 12.3804, None),
    ("Lago di Centro Cadore", 46.4499, 12.4144, None),
]


def hillshade(z, step, az=315.0, alt=40.0):
    gy, gx = np.gradient(z, step)  # rows go south (+z), columns east (+x)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gy, gx)
    a, h = np.radians(360.0 - az + 90.0), np.radians(alt)
    return np.clip(np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "mountains" / "antelao-profile.png"
    world = json.loads((ROOT / "data" / "worlds" / "antelao" / "world.json").read_text())
    line = json.loads(subprocess.run(["node", "tools/mountains/line.mjs", "antelao"], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    glaciers = json.loads((ROOT / "data" / "raw" / "osm" / "antelao" / "glaciers.json").read_text())["elements"]
    g = line["grid"]
    Z = np.array(g["data"], dtype=float).reshape(g["h"], g["w"])
    pts = line["line"]
    rk = np.array([p["rk"] for p in pts]) / 1000.0
    alt = np.array([p["alt"] for p in pts])
    lx, lz = np.array([p["x"] for p in pts]), np.array([p["z"] for p in pts])
    floor_km = line["floor"]["rk"] / 1000.0
    # the map and the profile stop 1.5 km below the valley floor: past it the line runs on Lago di Centro Cadore
    keep = rk <= floor_km + 1.5
    p0 = np.radians(world["frame"]["lat"])
    mlat = 111132.954 - 559.822 * np.cos(2 * p0) + 1.175 * np.cos(4 * p0)
    mlon = 111412.84 * np.cos(p0) - 93.5 * np.cos(3 * p0)

    def xz(lon, lat):
        return (lon - world["frame"]["lon"]) * mlon, -(lat - world["frame"]["lat"]) * mlat

    fig = plt.figure(figsize=(12, 11), dpi=110)
    ax = fig.add_axes([0.07, 0.42, 0.88, 0.55])
    ext = [g["x0"] / 1000, (g["x0"] + (g["w"] - 1) * g["step"]) / 1000, -(g["z0"] + (g["h"] - 1) * g["step"]) / 1000, -g["z0"] / 1000]
    hs = hillshade(Z, g["step"])
    ax.imshow(Z, extent=ext, cmap="terrain", vmin=Z.min() - 700, vmax=Z.max() + 150, interpolation="bilinear")
    ax.imshow(hs, extent=ext, cmap="gray", alpha=0.55, interpolation="bilinear")
    cs = ax.contour(np.linspace(ext[0], ext[1], g["w"]), np.linspace(ext[3], ext[2], g["h"]), Z, levels=np.arange(800, 3400, 200), colors="k", linewidths=0.35, alpha=0.45)
    ax.clabel(cs, fmt="%d", fontsize=6, inline=True)
    for e in glaciers:
        rings = [e["geometry"]] if e["type"] == "way" else [m["geometry"] for m in e.get("members", []) if m.get("role") == "outer"]
        for r in rings:
            gx, gz = zip(*(xz(p["lon"], p["lat"]) for p in r))
            ax.fill(np.array(gx) / 1000, -np.array(gz) / 1000, color="#bfe8ff", alpha=0.85, ec="#5aa9d6", lw=0.8)
    played = rk <= floor_km
    ax.plot(lx[played] / 1000, -lz[played] / 1000, color="white", lw=4.0, alpha=0.9, solid_capstyle="round")
    ax.plot(lx / 1000, -lz / 1000, color="#333", lw=1.2, ls="--", alpha=0.8, label="line read by the bake (Torrente Oten, then Torrente Molinà)")
    for k, s in enumerate(world["stages"]):
        cx = np.array([p["x"] for p in s["course"]]) + s["offset"]["x"]
        cz = np.array([p["z"] for p in s["course"]]) + s["offset"]["z"]
        ax.plot(cx / 1000, -cz / 1000, color=COLORS[k % len(COLORS)], lw=3.2, label=f"stage {k + 1}: {s['labels']['en']} ({s['altitude'][1]:.0f}-{s['altitude'][0]:.0f} m)")
        ax.plot(cx[-1] / 1000, -cz[-1] / 1000, "o", color=COLORS[k % len(COLORS)], ms=5, mec="white")
    ax.plot(0, 0, "^", color="k", ms=10, mec="white")
    ax.annotate(f"Antelao 3264 m (DEM {line['summit']['h']:.0f} m)", (0, 0), xytext=(-10, -14), textcoords="offset points", fontsize=8, weight="bold", ha="right")
    for name, lat, lon, _ in POINTS:
        x, z = xz(lon, lat)
        ax.plot(x / 1000, -z / 1000, "s", color="k", ms=3.5)
        ax.annotate(name, (x / 1000, -z / 1000), xytext=(5, 2), textcoords="offset points", fontsize=7)
    vis = keep
    pad = 1.0
    ax.set_xlim(max(ext[0], lx[vis].min() / 1000 - pad), min(ext[1], lx[vis].max() / 1000 + pad))
    ax.set_ylim(max(ext[2], -lz[vis].max() / 1000 - pad), min(ext[3], -lz[vis].min() / 1000 + pad))
    ax.set_aspect("equal")
    ax.set_xlabel("km east of the summit")
    ax.set_ylabel("km north of the summit")
    ax.set_title(f"{world['name']}: course at 1:1 on Copernicus GLO-30 (hillshade, 200 m contours, OSM glaciers)", fontsize=10)
    ax.legend(loc="lower left", fontsize=7, framealpha=0.85)

    bx = fig.add_axes([0.07, 0.06, 0.88, 0.29])
    r, a = rk[keep], alt[keep]
    bx.fill_between(r, a, a.min() - 100, color="#d9d4c7")
    bx.plot(r, a, color="#555", lw=1)
    for k, s in enumerate(world["stages"]):
        m = (rk >= s["realKm"][0]) & (rk <= s["realKm"][1])
        slope = (s["altitude"][1] - s["altitude"][0]) / s["length"] * 100
        bx.plot(rk[m], alt[m], color=COLORS[k % len(COLORS)], lw=4)
        bx.annotate(f"{k + 1}  {s['labels']['en']}\n{s['length']} m, {slope:.0f} %", (np.mean(s["realKm"]), s["altitude"][1]), xytext=(4, 6), textcoords="offset points", fontsize=7, color=COLORS[k % len(COLORS)], weight="bold")
        if k:
            b = world["stages"][k - 1]
            bx.annotate("", (s["realKm"][0], s["altitude"][1]), xytext=(b["realKm"][1], b["altitude"][0]), arrowprops=dict(arrowstyle="->", ls=":", color="#3a7bd5", lw=1))
    bx.axvline(floor_km, color="k", ls="--", lw=0.8)
    bx.annotate(f"valley floor {line['floor']['alt']:.0f} m\n(slope < {world['floor']['slope'] * 100:.0f} % over {world['floor']['window'] / 1000:.0f} km)", (floor_km, a.min()), xytext=(4, 8), textcoords="offset points", fontsize=7)
    for name, lat, lon, pub in POINTS:
        x, z = xz(lon, lat)
        i = int(np.argmin(np.hypot(lx - x, lz - z)))
        if not keep[i]:
            continue
        label = f"{name}\n{pub} m (bed {alt[i]:.0f})" if pub else f"{name}\nbed {alt[i]:.0f} m"
        bx.plot(rk[i], alt[i], "s", color="k", ms=3)
        bx.annotate(label, (rk[i], alt[i]), xytext=(3, -20), textcoords="offset points", fontsize=6.5)
    bx.set_xlim(r.min(), r.max())
    bx.set_ylim(a.min() - 100, a.max() + 250)
    bx.set_xlabel("km along the line (0 = first OSM stream node under the Ghiacciaio Inferiore, negative = summit path)")
    bx.set_ylabel("real bed altitude (m)")
    bx.set_title("Profile: played stages in colour, dotted arrows are the cloud jumps", fontsize=10)
    bx.grid(alpha=0.3)
    fig.text(0.07, 0.01, "Data: Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and Airbus 2014-2018, provided under COPERNICUS by the EU and ESA; waterways, glaciers and places (c) OpenStreetMap contributors, ODbL", fontsize=6.5, color="#555")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    print(out)


if __name__ == "__main__":
    main()
