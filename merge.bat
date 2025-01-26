@echo off
SET outputfile=compositefile.txt
IF EXIST %outputfile% del /f /q %outputfile%

FOR %%G IN (*.json *.js *.html) DO (
    echo file: %%G >> %outputfile%
    echo ``` >> %outputfile%
    type "%%G" >> %outputfile%
    echo. >> %outputfile%
    echo ``` >> %outputfile%
    echo. >> %outputfile%
)