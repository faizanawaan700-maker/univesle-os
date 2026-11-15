#!/usr/bin/env python3
"""Product Audit and Implementation Script"""
import os
import sys

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)

# Read current SpatialAppShell
spatial_path = 'C:\\\\Users\\\\admin\\\\OneDrive\\\\Desktop\\\\Univesle OS\\\\apps\\\\web\\\\src\\\\components\\\\SpatialAppShell.tsx'
with open(spatial_path, 'r') as f:
    content = f.read()

# Read design tokens
with open('C:\\\\Users\\\\admin\\\\OneDrive\\\\Desktop\\\\Univesle OS\\\\design-system\\\\ubos\\\\tokens.css', 'r') as f:
    tokens = f.read()

# Check current features
print('=== SpatialAppShell Analysis ===')
print('ambient-bg:', 'ambient-bg' in content)
print('app-shell:', 'app-shell' in content)
print('sidebarOpen:', 'sidebarOpen' in content)
print('initials:', 'initials' in content)
print('main-panel:', 'main-panel' in content)

print('\\n=== Design Tokens ===')
for t in ['--color-bg-primary', '--color-bg-secondary', '--color-bg-glass', '--color-text-primary', '--color-border-glass', '--shadow-glass', '--radius-lg']:
    print(f'  {t}: {t in tokens}')

# Read design system master
with open('C:\\\\Users\\\\admin\\\\OneDrive\\\\Desktop\\\\Univesle OS\\\\design-system\\\\ubos\\\\MASTER.md', 'r') as f:
    master = f.read()
print('\\n=== Design System ===')
print('SpatialAppShell in master:', 'SpatialAppShell' in master)

print('\\n=== Complete ===')
PYEOF\n",