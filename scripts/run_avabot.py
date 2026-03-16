"""Launcher for local AvaBot dev — adds site-packages and sets env vars."""
import sys, os

# Ensure user site-packages are found (needed when run without full user env)
user_pkgs = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Python", "Python314", "site-packages")
for p in [user_pkgs, r"C:\Python314\Lib\site-packages"]:
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

print("sys.path[:3]:", sys.path[:3], flush=True)

# Pre-import aiohttp so it's cached in sys.modules before runpy resets context
import aiohttp  # noqa
import litellm  # noqa
print("Imports OK", flush=True)

# Set env vars for local dev
os.environ.setdefault("AVABOT_DIR",     os.path.join(os.path.dirname(os.path.abspath(__file__)), "avabot_local"))
os.environ.setdefault("GEMINI_API_KEY", "AIzaSyBnvMRkvOy5NM82WMEdfrKY_xrMjCLMbuc")

# Run the server
import runpy
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "avabot_server.py"), run_name="__main__")
