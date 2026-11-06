"""Hillshade map and altitude profile of a baked world, for docs/mountains/<id>.md.

Usage: python3 tools/mountains/render_profile.py <id> [out.png]
Reads data/worlds/<id>/world.json and the whole descent line from tools/mountains/line.mjs (node, offline).
Top: hillshade of the DEM around the route, the line read by the bake (grey) and the played stages.
Bottom: real bed altitude along the line, the played stages, the cloud jumps, the valley floor, places.
Needs matplotlib and numpy (no install is done here).
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
COLORS = ["#2f6fdf", "#16a3a0", "#e0962a", "#c8443c", "#7b5bd6", "#4c9a2a"]


def hillshade(z, step, az=315.0, alt=40.0):
    gy, gx = np.gradient(z, step)  # rows go south (+z), columns east (+x)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gy, gx)
    a, h = np.radians(360.0 - az + 90.0), np.radians(alt)
    return np.clip(np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect), 0, 1)


def main():
    wid = sys.argv[1] if len(sys.argv) > 1 else "svizzera"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs" / "mountains" / f"{wid}-profile.png"
    world = json.loads((ROOT / "data" / "worlds" / wid / "world.json").read_text())
    line = json.loads(subprocess.run(["node", "tools/mountains/line.mjs", wid], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    g = line["grid"]
    Z = np.array(g["data"], dtype=float).reshape(g["h"], g["w"])
    pts = line["line"]
    rk = np.array([p["rk"] for p in pts]) / 1000.0
    alt = np.array([p["alt"] for p in pts])
    lx, lz = np.array([p["x"] for p in pts]), np.array([p["z"] for p in pts])
    floor_km = line["floor"]["rk"] / 1000.0

    fig = plt.figure(figsize=(11, 10.5), dpi=110)
    ax = fig.add_axes([0.07, 0.43, 0.88, 0.53])
    ext = [g["x0"] / 1000, (g["x0"] + (g["w"] - 1) * g["step"]) / 1000, -(g["z0"] + (g["h"] - 1) * g["step"]) / 1000, -g["z0"] / 1000]  # y is north
    hs = hillshade(Z, g["step"])
    ax.imshow(Z, extent=ext, cmap="terrain", vmin=Z.min() - 800, vmax=Z.max() + 200, interpolation="bilinear")
    ax.imshow(hs, extent=ext, cmap="gray", alpha=0.55, interpolation="bilinear")
    cs = ax.contour(np.linspace(ext[0], ext[1], g["w"]), np.linspace(ext[3], ext[2], g["h"]), Z, levels=np.arange(1500, 4600, 250), colors="k", linewidths=0.35, alpha=0.45)
    ax.clabel(cs, fmt="%d", fontsize=6, inline=True)
    played = rk <= floor_km
    ax.plot(lx[played] / 1000, -lz[played] / 1000, color="white", lw=4.0, alpha=0.9, solid_capstyle="round")
    ax.plot(lx / 1000, -lz / 1000, color="#333", lw=1.2, ls="--", alpha=0.8, label="line read by the bake")
    for k, s in enumerate(world["stages"]):
        cx = np.array([p["x"] for p in s["course"]]) + s["offset"]["x"]
        cz = np.array([p["z"] for p in s["course"]]) + s["offset"]["z"]
        ax.plot(cx / 1000, -cz / 1000, color=COLORS[k % len(COLORS)], lw=3.2, label=f"stage {k + 1}: {s['labels']['en']} ({s['altitude'][1]}-{s['altitude'][0]} m)")
        ax.plot(cx[-1] / 1000, -cz[-1] / 1000, "o", color=COLORS[k % len(COLORS)], ms=5, mec="white")
    ax.plot(0, 0, "^", color="k", ms=10, mec="white")
    ax.annotate(f"{world['places'][0]['name']} (DEM {line['summit']['h']:.0f} m)", (0, 0), xytext=(8, -4), textcoords="offset points", fontsize=8, weight="bold")
    from_lonlat = lambda lon, lat: ((lon - world["frame"]["lon"]) * mlon, -(lat - world["frame"]["lat"]) * mlat)  # noqa: E731
    p0 = np.radians(world["frame"]["lat"])
    mlat = 111132.954 - 559.822 * np.cos(2 * p0) + 1.175 * np.cos(4 * p0)
    mlon = 111412.84 * np.cos(p0) - 93.5 * np.cos(3 * p0)
    for p in world["places"][1:]:
        x, z = from_lonlat(p["lon"], p["lat"])
        if ext[0] < x / 1000 < ext[1] and ext[2] < -z / 1000 < ext[3]:
            ax.plot(x / 1000, -z / 1000, "s", color="k", ms=3.5)
            ax.annotate(p["name"], (x / 1000, -z / 1000), xytext=(4, 3), textcoords="offset points", fontsize=7)
    ax.set_xlim(ext[0], ext[1])
    ax.set_ylim(ext[2], ext[3])
    ax.set_aspect("equal")
    ax.set_xlabel("km east of the summit")
    ax.set_ylabel("km north of the summit")
    ax.set_title(f"{world['name']}: course at 1:1 on Copernicus GLO-30 (hillshade, 250 m contours)", fontsize=10)
    ax.legend(loc="lower right", fontsize=7, framealpha=0.85)

    bx = fig.add_axes([0.07, 0.06, 0.88, 0.3])
    bx.fill_between(rk, alt, alt.min() - 100, color="#d9d4c7")
    bx.plot(rk, alt, color="#555", lw=1)
    for k, s in enumerate(world["stages"]):
        m = (rk >= s["realKm"][0]) & (rk <= s["realKm"][1])
        slope = (s["altitude"][1] - s["altitude"][0]) / s["length"] * 100
        bx.plot(rk[m], alt[m], color=COLORS[k % len(COLORS)], lw=4)
        bx.annotate(f"{k + 1}  {s['labels']['en']}\n{s['length']} m, {slope:.0f} %", (np.mean(s["realKm"]), s["altitude"][1]), xytext=(4, 6), textcoords="offset points", fontsize=7, color=COLORS[k % len(COLORS)], weight="bold")
        if k:
            a = world["stages"][k - 1]
            bx.annotate("", (s["realKm"][0], s["altitude"][1]), xytext=(a["realKm"][1], a["altitude"][0]), arrowprops=dict(arrowstyle="->", ls=":", color="#3a7bd5", lw=1))
    bx.axvline(floor_km, color="k", ls="--", lw=0.8)
    bx.annotate(f"valley floor {line['floor']['alt']:.0f} m\n(slope < {world['floor']['slope'] * 100:.0f} % over {world['floor']['window'] / 1000:.0f} km)", (floor_km, alt.min()), xytext=(4, 8), textcoords="offset points", fontsize=7)
    for p in world["places"][1:]:
        if rk.min() <= p["riverKm"] <= rk.max() and p["distance"] < 300:
            y = float(np.interp(p["riverKm"], rk, alt))
            bx.plot(p["riverKm"], y, "s", color="k", ms=3)
            bx.annotate(p["name"], (p["riverKm"], y), xytext=(2, -11), textcoords="offset points", fontsize=6.5)
    bx.set_xlim(rk.min(), rk.max())
    bx.set_ylim(alt.min() - 100, alt.max() + 250)
    bx.set_xlabel("km along the line (0 = start of the OSM stream, negative = summit path)")
    bx.set_ylabel("real bed altitude (m)")
    bx.set_title("Profile: played stages in colour, dotted arrows are the cloud jumps", fontsize=10)
    bx.grid(alpha=0.3)
    fig.text(0.07, 0.01, "Data: Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and Airbus 2014-2018, provided under COPERNICUS by the EU and ESA; waterways and places (c) OpenStreetMap contributors, ODbL", fontsize=6.5, color="#555")
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    print(out)


if __name__ == "__main__":
    main()
