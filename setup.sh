echo "Installing kLaserCutter..."
path=$(pwd)
auto_script_filename=auto_start_when_boot_kLaserCutter
auto_script_location=/etc/init.d/$auto_script_filename
echo "Now path is: $path"

apt-get install libjpeg62-dev imagemagick v4l-utils subversion -y

wget http://k2.arduino.vn/img/2016/08/30/0/3093_882450-1472565139-0-mjpg-streamer.zip -O mjpg-streamer.tar.gz
tar xvzf mjpg-streamer.tar.gz
cd mjpg-streamer/mjpg-streamer
make
make install
cd ../..
rm -rf mjpg-streamer
rm -rf mjpg-streamer.tar.gz


echo "Create a auto start bash shell"
echo "#!/bin/bash" > $auto_script_location
echo "cd $path/bin && ./checkSVG2gcodealive.sh > /dev/null 2>&1 &" >> $auto_script_location
echo "exit 0" >> $auto_script_location
chmod 0755 $auto_script_location
update-rc.d $auto_script_filename defaults