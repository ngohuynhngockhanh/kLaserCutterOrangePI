echo "Installing kLaserCutter..."
path=$(pwd)
auto_script_filename=auto_start_when_boot_kLaserCutter
auto_script_location=/etc/init.d/$auto_script_filename
echo "Now path is: $path"



echo "Create a auto start bash shell"
echo "#!/bin/bash" > $auto_script_location
echo "cd $path/bin && ./checkSVG2gcodealive.sh > /dev/null 2>&1 &" >> $auto_script_location
echo "exit 0" >> $auto_script_location
chmod 0755 $auto_script_location
update-rc.d $auto_script_filename defaults