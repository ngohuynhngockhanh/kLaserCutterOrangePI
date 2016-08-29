#!/bin/bash 


DIR=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )
process="klasercutter.js"

mount -t tmpfs -o size=50M tmpfs ./../upload/ 
chmod 0777 ./../upload/ 

while true;
do
	if ps | grep -v grep | grep $process > /dev/null         
	then                 
		echo "Process $process is running"         
	else        
		echo "Start SVG2gcode again"
		echo $DIR
		cd $DIR && cd ./../ && sudo ./klasercutter.js
	fi
	sleep 10
done
