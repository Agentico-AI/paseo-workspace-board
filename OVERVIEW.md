Workspace Board displays active Paseo workspaces in columns based on their native labels. Each column uses the label color and groups cards by Paseo status. Cards are ordered by recent interaction and open their workspace when selected.

The board can include online hosts connected to the Paseo app. Host and project filters support multiple selections. You can save their current selection as a named view and return to it from a pill. View all clears both filters. The selected filters and saved views are stored on the plugin's installation host.

The board reads workspaces and agents through Paseo's SDK. A local daemon connection reads native labels and project icons and performs label, pin, and unread actions. Rename and archive use the SDK. Desktop drag and drop changes labels for workspaces on the plugin's host. Workspaces on other hosts can be opened and filtered, but their native labels cannot be changed from this installation. The plugin does not assign labels automatically or send workspace data to a third party.

Paseo 0.11.2 or later is required. The board works in the desktop app, browser, and mobile app. Drag and drop is available in desktop web surfaces; other actions remain available in the card menu. Host colors are a visual approximation because Paseo does not expose each host's chosen appearance to plugins.
