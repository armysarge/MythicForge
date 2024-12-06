// Document ready function
$.when( $.ready ).then(function() {

    // Focus on window when clicked
    $(".mythicForgeWindow").on("click tap", function(evt) {
        if ($(this).hasClass("focused")) return;
        $(".mythicForgeWindow").removeClass("focused");
        $(this).css("z-index", mythicForgeWindowIndex()).addClass("focused");
    });

    // Open and close the database window
    $(".showBestiary").on("click tap", function(evt) {
        if ($(".bestiaryWindow").css("display") == "block") {
            $(".bestiaryWindow").css("display", "none");
            return;
        }
        $(".bestiaryWindow").css({
            "display": "block",
            "z-index": mythicForgeWindowIndex(),
        });
        centerDivToScreen(".bestiaryWindow");
    });

    //Make windows draggable
    $(".bestiaryWindow").draggable({containment: "parent"});
    $( ".bestiaryWindow" ).resizable({
        maxHeight: 600,
        maxWidth: 800,
        minHeight: 150,
        minWidth: 200
    });
});

// Function to get the highest z-index of all mythicForgeWindows
function mythicForgeWindowIndex(){
    var highestZ = 0;
    $(".mythicForgeWindow").each(function() {
        var currentZ = parseInt($(this).css("z-index"), 10);
        if (currentZ > highestZ)
            highestZ = currentZ;
    });
    return highestZ+1;
}

// Function to center a div to the screen
function centerDivToScreen(div){
    var divWidth = $(div).width();
    var divHeight = $(div).height();
    var windowWidth = $(window).width();
    var windowHeight = $(window).height();
    $(div).css({
        "left": windowWidth/2 - divWidth/2,
        "top": windowHeight/2 - divHeight/2
    });
}