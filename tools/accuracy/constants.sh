# The web build's -constant s that change what Audiveris reads (public/omr/omr-worker.js): every native run
# passes them, and a resumed book needs them again (they aren't stored in it: without indentations=false
# Wichita Lineman came out as two movements). The worker's other two — Main.sheetStepTimeOut and
# OmrExecutors.graceDelay — only bound how long a step or a shutdown may take. The fast tier checks this
# list against the worker's (accuracy/constcheck.mjs).
ACC_CONSTANTS="-constant org.audiveris.omr.sheet.ProcessingSwitches.indentations=false -constant org.audiveris.omr.util.OmrExecutors.useParallelism=false"
