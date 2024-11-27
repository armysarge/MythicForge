$.when( $.ready ).then(function() {
    console.log("Document ready");
    $(".mythicForgeWindow").on("click tap", function(evt) {
        if ($(this).hasClass("focused")) return;
        $(".mythicForgeWindow").removeClass("focused");
        $(this).css("z-index", mythicForgeWindowIndex()).addClass("focused");
    });

    $(".showDatabase").on("click tap", function(evt) {
        if ($(".databaseWindow").css("display") == "block") {
            $(".databaseWindow").css("display", "none");
            return;
        }
        $(".databaseWindow").css({
            "display": "block",
            "z-index": mythicForgeWindowIndex(),
            "top": "50%",
            "left": "50%",
            "transform": "translate(-50%, -50%)"
        });
    });
});

function mythicForgeWindowIndex(){
    var highestZ = 0;
    $(".mythicForgeWindow").each(function() {
        var currentZ = parseInt($(this).css("z-index"), 10);
        if (currentZ > highestZ)
            highestZ = currentZ;
    });
    return highestZ+1;
}